import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCurrentUserAccess, hasVendasAccess } from "@/app/api/_authz/perms";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { fetchAllSupabaseRows, fetchAllSupabaseRowsByChunks } from "@/lib/supabase-pagination";
import {
  decidirRecorte,
  podeAlterarTransacao,
  podeLerTransacao,
  type DocumentoDoPagamento,
  type RecorteDeAutoria,
} from "./autoria-regra";

export {
  aplicarRecorteDeAutoria,
  expressaoDeAutoria,
  leApenasMinhas,
  podeAlterarTransacao,
  type RecorteDeAutoria,
} from "./autoria-regra";

export type ContextoDeAutoria = {
  podeVerTudo: boolean;
  usuarioId: string;
  autoresAdministrativos: ReadonlySet<string>;
};

function erroDeAcesso(statusCode: number, mensagem: string) {
  return Object.assign(new Error(mensagem), { statusCode });
}

/**
 * Lê o perfil ATUAL dos criadores, inclusive desativados. Não há classificação
 * permanente na transação nem cache adicional que atrase mudanças de perfil.
 * O chamador reutiliza este contexto nas consultas e operações da requisição.
 */
export async function contextoDeAutoria(): Promise<ContextoDeAutoria> {
  const acesso = await getCurrentUserAccess();
  if (!acesso?.ativo) throw erroDeAcesso(401, "Não autenticado");
  const podeVerTudo = permissionSetHas(acesso.permissoes, PERMS.FINANCEIRO_VER_TODAS_TRANSACOES);
  const autoresAdministrativos = new Set<string>();
  if (!podeVerTudo) {
    const usuarios = await fetchAllSupabaseRows<{
      id: string;
      perfil: { perfilpermissao: Array<{ permissao: { nome: string } | null }> } | null;
    }>(() => supabaseAdmin
      .from("usuario")
      .select("id, perfil:perfilid(perfilpermissao(permissao:permissaoid(nome)))")
      .order("id", { ascending: true }));
    for (const usuario of usuarios) {
      const permissoes = usuario.perfil?.perfilpermissao.map((vinculo) => vinculo.permissao?.nome) ?? [];
      if (permissionSetHas(permissoes, PERMS.FINANCEIRO_VER_TODAS_TRANSACOES)) {
        autoresAdministrativos.add(usuario.id);
      }
    }
  }
  return { podeVerTudo, usuarioId: acesso.id, autoresAdministrativos };
}

export async function recorteDeAutoria(
  apenasMinhas: boolean,
  contexto?: ContextoDeAutoria,
): Promise<RecorteDeAutoria> {
  const acesso = contexto ?? await contextoDeAutoria();
  return decidirRecorte(acesso.podeVerTudo, apenasMinhas, acesso.usuarioId, acesso.autoresAdministrativos);
}

export async function criterioDeAlteracao(
  contexto?: ContextoDeAutoria,
): Promise<(createdBy: string | null) => boolean> {
  const acesso = contexto ?? await contextoDeAutoria();
  return (createdBy) => podeAlterarTransacao({ ...acesso, createdBy });
}

function normalizarIds(ids: number | string | Array<number | string>): number[] {
  return [...new Set((Array.isArray(ids) ? ids : [ids])
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0))];
}

type DonoDaTransacao = {
  id: number;
  created_by: string | null;
  ordemservicoid: number | null;
  vendaid: number | null;
  baixa_de_transacao_id: number | null;
};

async function donosDasTransacoes(lista: number[]) {
  return fetchAllSupabaseRowsByChunks<DonoDaTransacao, number>(lista, (ids) => supabaseAdmin
    .from("transacao")
    .select("id, created_by, ordemservicoid, vendaid, baixa_de_transacao_id")
    .in("id", ids)
    .order("id", { ascending: true }), 100);
}

function recusar(administrativas: Array<{ id: number }>): never {
  throw erroDeAcesso(403, administrativas.length === 1
    ? "A transação #" + administrativas[0].id + " pertence ao Caixa administrativo."
    : administrativas.length + " das transações pertencem ao Caixa administrativo.");
}

/** Compartilha operações comuns; a permissão da ação continua obrigatória. */
export async function exigirAcessoATransacao(
  ids: number | string | Array<number | string>,
  contexto?: ContextoDeAutoria,
): Promise<void> {
  const lista = normalizarIds(ids);
  if (!lista.length) return;
  const acesso = contexto ?? await contextoDeAutoria();
  if (acesso.podeVerTudo) return;
  const linhas = await donosDasTransacoes(lista);
  // Alterar/excluir uma baixa parcial também modifica o saldo do título pai.
  const pais = [...new Set(linhas.flatMap((linha) =>
    linha.baixa_de_transacao_id != null ? [Number(linha.baixa_de_transacao_id)] : []))];
  const afetadas = [...linhas, ...await donosDasTransacoes(pais)];
  const administrativas = afetadas.filter(
    (linha) => !podeAlterarTransacao({ ...acesso, createdBy: linha.created_by }),
  );
  if (administrativas.length) recusar(administrativas);
}

async function transacoesSemLeitura(
  ids: number | string | Array<number | string>,
  contexto?: ContextoDeAutoria,
): Promise<DonoDaTransacao[]> {
  const lista = normalizarIds(ids);
  if (!lista.length) return [];
  const acesso = contexto ?? await contextoDeAutoria();
  if (acesso.podeVerTudo) return [];
  const administrativas = (await donosDasTransacoes(lista)).filter(
    (linha) => !podeAlterarTransacao({ ...acesso, createdBy: linha.created_by }),
  );
  if (!administrativas.length) return [];
  // O módulo de OS foi removido: ninguém tem acesso a documento de OS.
  const OS = false;
  const VENDA = await hasVendasAccess();
  const acessoA = { OS, VENDA };
  const documentos = new Map<number, Set<DocumentoDoPagamento>>();
  for (const linha of administrativas) {
    const conjunto = new Set<DocumentoDoPagamento>();
    if (linha.ordemservicoid != null) conjunto.add("OS");
    if (linha.vendaid != null) conjunto.add("VENDA");
    documentos.set(linha.id, conjunto);
  }
  if (OS || VENDA) {
    const rateios = await fetchAllSupabaseRowsByChunks<{
      transacao_id: number; tipo_documento: DocumentoDoPagamento;
    }, number>(administrativas.map((linha) => linha.id), (ids) => supabaseAdmin
      .from("pagamento_multiplo_rateio")
      .select("id, transacao_id, tipo_documento")
      .in("transacao_id", ids)
      .order("id", { ascending: true }), 100);
    for (const linha of rateios) documentos.get(linha.transacao_id)?.add(linha.tipo_documento);
  }
  const recusadas = administrativas.filter((linha) => !podeLerTransacao({
    ...acesso,
    createdBy: linha.created_by,
    documentos: [...(documentos.get(linha.id) ?? [])],
    acessoA,
  }));
  return recusadas;
}

/** Preserva a exceção de leitura de pagamentos em OS e vendas. */
export async function exigirLeituraDeTransacao(
  ids: number | string | Array<number | string>,
  contexto?: ContextoDeAutoria,
): Promise<void> {
  const recusadas = await transacoesSemLeitura(ids, contexto);
  if (recusadas.length) recusar(recusadas);
}

/** Filtra vínculos auxiliares antes de produzir seus detalhes e somatórios. */
export async function filtrarTransacoesLegiveis<T extends { id: number }>(
  linhas: T[],
  contexto: ContextoDeAutoria,
): Promise<T[]> {
  const recusadas = new Set((await transacoesSemLeitura(linhas.map((linha) => linha.id), contexto)).map((linha) => linha.id));
  return linhas.filter((linha) => !recusadas.has(Number(linha.id)));
}
