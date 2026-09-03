import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchAllSupabaseRows } from "@/lib/supabase-pagination";
import { STATUS_OS_FINALIZADAS, resolverTextosServico } from "@/lib/meu-perfil/regras";

/**
 * Comissões de serviço, por realizador e por setor.
 *
 * Os dois relatórios de comissão — o por realizador e o por setor — e a folha
 * de impressão do segundo tinham, cada um, a sua própria consulta. As três
 * discordavam entre si e nenhuma batia com a Central Pessoal, que é onde o
 * realizador confere o próprio trabalho. Agora as três leem daqui.
 *
 * O recorte é **o mesmo de `api/me/servicos`**, e as constantes vêm literalmente
 * do módulo daquela aba (`@/lib/meu-perfil/regras`), não de uma cópia: se a
 * Central Pessoal mudar de regra, os relatórios mudam junto ou o build quebra.
 *
 * O que estava errado, medido na base:
 *
 * - **O relatório por realizador não filtrava nada.** Sem status e sem
 *   `is_deleted`, ele somava comissão de OS `EM_ANDAMENTO` e até de OS
 *   `CANCELADO` — R$ 2.338,50 a mais que o devido.
 *
 * - **O por setor exigia `CONCLUIDO`** e perdia a OS em `PAGAMENTO`, que já
 *   executou e só espera a quitação.
 *
 * - **O eixo de período era `datasaida || createdat`.** `datasaida` é digitada à
 *   mão e estava vazia em 77 das 98 OS do recorte, então a maioria caía na data
 *   de criação do registro: em metade das ordens o mês apurado era outro. Aqui o
 *   eixo é `execucao_fim_em`, carimbado pelo sistema quando a execução termina —
 *   o mesmo da Central Pessoal e do relatório de OS.
 *
 * - **Tudo era filtrado em memória**, sobre consultas sem `.range()`.
 *
 * Sobre o valor: quem manda é `osservico_realizador.valor_comissao`, o snapshot
 * gravado quando o serviço foi encerrado. `servico.gera_comissao` já foi aplicado
 * ali pelo gatilho `recalcular_comissao_osservico`; a flag de hoje **não**
 * reescreve trabalho já apurado — é o que a migração que a criou determina, e
 * evita que desmarcar um serviço mude retroativamente um mês já pago. A flag
 * atual viaja junto como informação, para o leitor entender a linha zerada.
 */

const TIMEZONE = "America/Fortaleza";
const LOCAL_OFFSET = "-03:00";

const ID_SEM_SETOR = "SEM_SETOR";

function startOfDay(value: string) {
  return new Date(`${value}T00:00:00${LOCAL_OFFSET}`).toISOString();
}

function nextDay(value: string) {
  return new Date(new Date(`${value}T00:00:00${LOCAL_OFFSET}`).getTime() + 86_400_000).toISOString();
}

/** Data no fuso da oficina — não no de quem hospeda o servidor. */
export function formatarDataHora(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIMEZONE,
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function formatarData(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TIMEZONE, dateStyle: "short" }).format(date);
}

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function texto(value: unknown) {
  return String(value ?? "").trim();
}

/** O Supabase devolve a junção ora como objeto, ora como lista de um. */
function juncao(valor: unknown): any {
  return Array.isArray(valor) ? valor[0] ?? null : valor ?? null;
}

export type LinhaDeComissao = {
  ordemId: number;
  servicoId: number;
  usuarioId: string;
  servicoCodigo: string;
  /** Título do cadastro, ou o complemento da OS quando o serviço sumiu. */
  servicoDescricao: string;
  /** Complemento gravado na linha da OS, quando difere do título. */
  servicoComplemento: string;
  /** `servico.gera_comissao` como está hoje — explica a linha zerada. */
  geraComissao: boolean;
  quantidade: number;
  precoUnitario: number;
  subtotalServico: number;
  valorBase: number;
  /**
   * A taxa que de fato pagou a linha. Em serviço com mais de um realizador é o
   * maior percentual do grupo, não a taxa individual de quem recebeu — é o que
   * faz `valorBase × percentualAplicado` fechar com `valorComissao`.
   */
  percentualAplicado: number;
  valorComissao: number;
  osStatus: string;
  osEntrada: string;
  osSaida: string;
  execucaoInicio: string;
  execucaoFim: string;
  clienteId: number | null;
  clienteNome: string;
  clienteDocumento: string;
};

export type RealizadorComComissoes = {
  userId: string;
  nome: string;
  email: string;
  itens: LinhaDeComissao[];
  totalBase: number;
  totalComissao: number;
};

export type SetorComComissoes = {
  setorId: string;
  nome: string;
  realizadores: RealizadorComComissoes[];
  totalBase: number;
  totalComissao: number;
};

export type RelatorioDeComissoes = {
  linhas: LinhaDeComissao[];
  setores: SetorComComissoes[];
  totalBase: number;
  totalComissao: number;
};

export type FiltroDeComissoes = {
  inicio?: string;
  fim?: string;
  /** Id do setor do realizador; vazio ou "all" traz todos. */
  setor?: string;
  /** Um realizador específico — o recorte do relatório por realizador. */
  usuarioId?: string;
};

/**
 * O mesmo caminho de `api/me/servicos`: `osservico_realizador` não tem FK direta
 * para `ordemservico` (a chave é composta e aponta para `osservico`), então a OS
 * é alcançada em dois saltos. O `!inner` em cada nível vira join, o que permite
 * filtrar status, exclusão e período no banco, numa consulta só.
 */
const SELECT = `
  ordemservicoid,
  servicoid,
  usuarioid,
  valor_base,
  valor_comissao,
  comissao_percent_aplicada,
  comissao_percent_efetiva,
  item:osservico!inner (
    descricao,
    quantidade,
    precounitario,
    subtotal,
    servico:servicoid ( id, codigo, descricao, gera_comissao ),
    ordem:ordemservicoid!inner (
      id,
      status,
      is_deleted,
      dataentrada,
      datasaida,
      execucao_inicio_em,
      execucao_fim_em,
      cliente:clienteid ( id, nomerazaosocial, cpfcnpj )
    )
  )
`;

/**
 * Realizadores de um setor, para o filtro entrar na consulta e não no JS.
 *
 * Devolve `null` só quando não há filtro. Um setor que não existe devolve lista
 * vazia — e não `null`: tratar valor desconhecido como "sem filtro" fazia um
 * endereço com setor inválido despejar a comissão da empresa inteira.
 *
 * `SEM_SETOR` é o grupo que o próprio relatório imprime para quem não tem setor
 * vinculado; sem este ramo ele aparecia na folha e não podia ser filtrado.
 */
async function realizadoresDoSetor(setor: string) {
  if (!setor || setor === "all") return null;

  if (setor === ID_SEM_SETOR) {
    const { data, error } = await supabaseAdmin.from("usuario").select("id").is("setorid", null);
    if (error) throw error;
    return (data ?? []).map((usuario: any) => String(usuario.id));
  }

  const setorId = Number(setor);
  if (!Number.isInteger(setorId) || setorId <= 0) return [];

  const { data, error } = await supabaseAdmin.from("usuario").select("id").eq("setorid", setorId);
  if (error) throw error;
  return (data ?? []).map((usuario: any) => String(usuario.id));
}

export async function carregarComissoes(filtro: FiltroDeComissoes): Promise<RelatorioDeComissoes> {
  const inicio = (filtro.inicio ?? "").trim();
  const fim = (filtro.fim ?? "").trim();
  const usuarioId = (filtro.usuarioId ?? "").trim();

  const idsDoSetor = await realizadoresDoSetor(filtro.setor ?? "");
  // Setor sem nenhum usuário vinculado: não há o que buscar, e um `in` com
  // lista vazia é um erro à espera de acontecer.
  if (idsDoSetor && idsDoSetor.length === 0) {
    return { linhas: [], setores: [], totalBase: 0, totalComissao: 0 };
  }

  const registros = await fetchAllSupabaseRows<any>(() => {
    let query = supabaseAdmin
      .from("osservico_realizador")
      .select(SELECT)
      .eq("item.ordem.is_deleted", false)
      .in("item.ordem.status", STATUS_OS_FINALIZADAS as unknown as string[])
      // Sem execução encerrada não há trabalho concluído a comissionar — e é o
      // que garante que o eixo de período nunca seja nulo.
      .not("item.ordem.execucao_fim_em", "is", null);

    if (inicio) query = query.gte("item.ordem.execucao_fim_em", startOfDay(inicio));
    if (fim) query = query.lt("item.ordem.execucao_fim_em", nextDay(fim));
    if (usuarioId) query = query.eq("usuarioid", usuarioId);
    if (idsDoSetor) query = query.in("usuarioid", idsDoSetor);

    return query
      .order("ordemservicoid", { ascending: true })
      .order("servicoid", { ascending: true });
  });

  const linhas: LinhaDeComissao[] = registros.map((registro) => {
    const item = juncao(registro.item);
    const servico = juncao(item?.servico);
    const ordem = juncao(item?.ordem);
    const cliente = juncao(ordem?.cliente);
    const textos = resolverTextosServico(servico?.descricao, item?.descricao, "Serviço removido da OS");

    return {
      ordemId: Number(registro.ordemservicoid),
      servicoId: Number(registro.servicoid),
      usuarioId: String(registro.usuarioid ?? ""),
      servicoCodigo: texto(servico?.codigo),
      servicoDescricao: textos.descricao,
      servicoComplemento: textos.subdescricao ?? "",
      // Serviço apagado do cadastro mantém o comportamento antigo do gatilho.
      geraComissao: servico?.gera_comissao !== false,
      quantidade: num(item?.quantidade),
      precoUnitario: num(item?.precounitario),
      subtotalServico: num(item?.subtotal),
      valorBase: num(registro.valor_base),
      percentualAplicado:
        registro.comissao_percent_efetiva == null
          ? num(registro.comissao_percent_aplicada)
          : num(registro.comissao_percent_efetiva),
      valorComissao: num(registro.valor_comissao),
      osStatus: texto(ordem?.status),
      osEntrada: formatarDataHora(ordem?.dataentrada),
      osSaida: formatarDataHora(ordem?.datasaida),
      execucaoInicio: formatarDataHora(ordem?.execucao_inicio_em),
      execucaoFim: formatarDataHora(ordem?.execucao_fim_em),
      clienteId: cliente?.id != null ? Number(cliente.id) : null,
      clienteNome: texto(cliente?.nomerazaosocial),
      clienteDocumento: texto(cliente?.cpfcnpj),
    };
  });

  const setores = await agruparPorSetor(linhas);

  return {
    linhas,
    setores,
    totalBase: linhas.reduce((soma, linha) => soma + linha.valorBase, 0),
    totalComissao: linhas.reduce((soma, linha) => soma + linha.valorComissao, 0),
  };
}

/**
 * Agrupa por setor **do realizador**, e não da OS: a comissão é de quem
 * executou, e é assim que o relatório sempre leu.
 */
async function agruparPorSetor(linhas: LinhaDeComissao[]): Promise<SetorComComissoes[]> {
  if (linhas.length === 0) return [];

  const userIds = [...new Set(linhas.map((linha) => linha.usuarioId).filter(Boolean))];
  const { data: usuarios, error: usuariosErro } = await supabaseAdmin
    .from("usuario")
    .select("id, nome, email, setorid")
    .in("id", userIds);
  if (usuariosErro) throw usuariosErro;

  const { data: setoresRows, error: setoresErro } = await supabaseAdmin.from("setor").select("id, nome");
  if (setoresErro) throw setoresErro;

  const usuarioPorId = new Map((usuarios ?? []).map((u: any) => [String(u.id), u]));
  const nomeDoSetor = new Map((setoresRows ?? []).map((s: any) => [String(s.id), s.nome as string]));

  const porSetor = new Map<string, SetorComComissoes>();

  for (const linha of linhas) {
    const usuario = usuarioPorId.get(linha.usuarioId);
    const setorId = usuario?.setorid ? String(usuario.setorid) : ID_SEM_SETOR;

    if (!porSetor.has(setorId)) {
      porSetor.set(setorId, {
        setorId,
        nome: setorId === ID_SEM_SETOR ? "Sem Setor" : nomeDoSetor.get(setorId) || "Setor Oculto",
        realizadores: [],
        totalBase: 0,
        totalComissao: 0,
      });
    }

    const grupoDoSetor = porSetor.get(setorId)!;
    let grupoDoRealizador = grupoDoSetor.realizadores.find((item) => item.userId === linha.usuarioId);
    if (!grupoDoRealizador) {
      grupoDoRealizador = {
        userId: linha.usuarioId,
        nome: texto(usuario?.nome) || texto(usuario?.email) || "Realizador Desconhecido",
        email: texto(usuario?.email),
        itens: [],
        totalBase: 0,
        totalComissao: 0,
      };
      grupoDoSetor.realizadores.push(grupoDoRealizador);
    }

    grupoDoRealizador.itens.push(linha);
    grupoDoRealizador.totalBase += linha.valorBase;
    grupoDoRealizador.totalComissao += linha.valorComissao;
    grupoDoSetor.totalBase += linha.valorBase;
    grupoDoSetor.totalComissao += linha.valorComissao;
  }

  const setores = [...porSetor.values()];
  setores.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  setores.forEach((setor) => setor.realizadores.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
  return setores;
}
