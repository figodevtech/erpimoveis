import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchAllSupabaseRows, fetchAllSupabaseRowsByChunks } from "@/lib/supabase-pagination";
import { aplicarFiltrosServicos, type ConsultaPaginadaServicos } from "./servicos-realizados-consulta";
import { autoresDasAtribuicoes, chaveVinculo, geracaoNoCalculo, normalizarServico, objeto, texto, type EventoAtribuicao, type EventoComissao, type FiltrosServicos } from "./servicos-realizados";

export const SELECT_SERVICOS: string = `ordemservicoid, servicoid, usuarioid, createdat,
  valor_base, valor_comissao, valor_comissao_manual, comissao_percent_aplicada, comissao_percent_efetiva,
  status_execucao, iniciado_em, finalizado_em,
  usuario:usuarioid (nome, comissao_percent, setorid, setor:setorid (nome)),
  item:osservico!inner (
    descricao, quantidade, subtotal, servico:servicoid (codigo, descricao, gera_comissao),
    ordem:ordemservicoid!inner (
      status, is_deleted, dataentrada, execucao_fim_em, setorid, usuariocriadorid, clienteid, cliente_snapshot,
      setor:setorid (nome), criador:usuario!usuariocriadorid (nome), cliente:clienteid (nomerazaosocial)
    )
  )`;

export async function carregarServicosRealizados(filtros: FiltrosServicos) {
  const registros = await fetchAllSupabaseRows<Record<string, unknown>>(() =>
    aplicarFiltrosServicos(supabaseAdmin.from("osservico_realizador").select(SELECT_SERVICOS) as unknown as ConsultaPaginadaServicos, filtros));
  const linhas = registros.map(r => normalizarServico(r, filtros.campoData));
  const ids = [...new Set(linhas.map(l => String(l.ordemId)))];
  const [eventos, comissoes] = await Promise.all([
    fetchAllSupabaseRowsByChunks<EventoAtribuicao, string>(ids, chunk => supabaseAdmin
      .from("auditoria_evento")
      .select("id, ocorrido_em, operacao, usuario_id, ator_nome, dados_novos, dados_anteriores, usuario:usuario_id(nome)")
      .eq("tabela", "osservico_realizador").in("operacao", ["INSERT", "DELETE"])
      .in("registro_id", chunk).order("id", { ascending: true })),
    fetchAllSupabaseRowsByChunks<EventoComissao, string>(ids, chunk => supabaseAdmin
      .from("eventos_financeiros")
      .select("ordemservicoid, chave_origem, dados_snapshot")
      .eq("origem", "COMISSAO").eq("natureza", "DESPESA").neq("status", "CANCELADO")
      .in("ordemservicoid", chunk).order("id", { ascending: true })),
  ]);
  const autores = autoresDasAtribuicoes(eventos);
  const geracao = geracaoNoCalculo(comissoes);
  linhas.forEach((linha, i) => {
    const autor = autores.get(chaveVinculo(linha));
    const criadoEm = texto(registros[i].createdat);
    // createdat identifica esta ocorrência do vínculo, mesmo após remover/reinserir.
    // Sem carimbo correspondente não há evidência de autoria do vínculo atual.
    if (autor?.criadoEm && criadoEm && Date.parse(autor.criadoEm) === Date.parse(criadoEm)) linha.atribuidoPor = autor.nome;
    const gerava = geracao.get(chaveVinculo(linha));
    if (gerava !== undefined) linha.geraComissaoNoCalculo = gerava;
  });
  return linhas;
}

export async function carregarOpcoesServicos() {
  const [usuarios, setores] = await Promise.all([
    fetchAllSupabaseRows<Record<string, unknown>>(() => supabaseAdmin.from("usuario").select("id, nome, ativo").order("nome", { ascending: true }).order("id", { ascending: true })),
    fetchAllSupabaseRows<Record<string, unknown>>(() => supabaseAdmin.from("setor").select("id, nome").order("nome", { ascending: true }).order("id", { ascending: true })),
  ]);
  return { pessoas: usuarios.map(u => ({ id: texto(u.id), nome: texto(u.nome) || "Usuário não identificado", ativo: u.ativo !== false })),
    setores: setores.map(s => ({ id: texto(s.id), nome: texto(s.nome) || "Sem nome" })) };
}

export async function carregarEmpresaRelatorio() {
  const { data, error } = await supabaseAdmin.from("empresa").select("nomefantasia, razaosocial, cnpj").limit(1).maybeSingle();
  if (error) throw error;
  const e = objeto(data);
  return { nome: texto(e.nomefantasia) || texto(e.razaosocial) || "Oficina", cnpj: texto(e.cnpj) };
}
