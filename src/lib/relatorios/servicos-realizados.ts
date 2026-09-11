import { STATUS_OS_VALIDOS } from "@/lib/ordens/destaque";
import { resolverTextosServico } from "@/lib/meu-perfil/regras";
import { resolveOrdemCustomer } from "@/lib/ordens/customer-snapshot";

export const CAMPOS_DATA = { entrada: "Entrada da OS", conclusao: "Conclusão da execução da OS", servico: "Término individual do serviço" } as const;
/**
 * Dois setores convivem no relatório e não são a mesma coisa: o da OS diz onde
 * o trabalho foi aberto; o do realizador, a que setor a pessoa pertence no
 * cadastro. Numa OS de mecânica atendida por alguém da elétrica, os dois
 * agrupamentos põem o mesmo serviço em setores diferentes.
 */
export const AGRUPAMENTOS = { realizador: "Realizador", setor: "Setor da OS", setorRealizador: "Setor do realizador", criador: "Criador da OS" } as const;
export const SITUACOES = { PENDENTE: "Pendente", EM_EXECUCAO: "Em execução", FINALIZADO: "Finalizado" } as const;
export type FiltrosServicos = {
  dateFrom: string; dateTo: string; campoData: keyof typeof CAMPOS_DATA;
  agruparPor: keyof typeof AGRUPAMENTOS; status: string[];
  criadorId: string; realizadorId: string; setorId: string; ordemId: string; clienteId: string;
  situacao: string;
};
export class FiltroInvalido extends Error { readonly statusCode = 400; }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function lerFiltrosServicos(params: URLSearchParams): FiltrosServicos {
  const get = (key: string) => (params.get(key) ?? "").trim();
  const date = (key: string) => {
    const value = get(key);
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new FiltroInvalido("Data inválida.");
    return value;
  };
  const id = (key: string, uuid = false) => {
    const value = get(key);
    if (value && !(uuid ? UUID.test(value) : /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)))) throw new FiltroInvalido("Identificador inválido.");
    return value;
  };
  const campoData = get("campoData") || "entrada";
  const agruparPor = get("agruparPor") || "realizador";
  const situacao = get("situacao");
  if (!Object.hasOwn(CAMPOS_DATA, campoData) || !Object.hasOwn(AGRUPAMENTOS, agruparPor) || (situacao && !Object.hasOwn(SITUACOES, situacao))) throw new FiltroInvalido("Opção de relatório inválida.");
  const status = [...new Set(get("status").split(",").map(s => s.trim().toUpperCase()).filter(Boolean))];
  if (status.some(s => !(STATUS_OS_VALIDOS as readonly string[]).includes(s))) throw new FiltroInvalido("Status da OS inválido.");
  const dateFrom = date("dateFrom"), dateTo = date("dateTo");
  if (dateFrom && dateTo && dateFrom > dateTo) throw new FiltroInvalido("A data inicial não pode ser posterior à data final.");
  return { dateFrom, dateTo, campoData: campoData as FiltrosServicos["campoData"], agruparPor: agruparPor as FiltrosServicos["agruparPor"], status, situacao,
    criadorId: id("criadorId", true), realizadorId: id("realizadorId", true), setorId: get("setorId") === "SEM_SETOR" ? "SEM_SETOR" : id("setorId"), ordemId: id("ordemId"), clienteId: id("clienteId") };
}

export function limitesPeriodo(f: Pick<FiltrosServicos, "dateFrom" | "dateTo">) {
  return { inicio: f.dateFrom ? new Date(`${f.dateFrom}T00:00:00-03:00`).toISOString() : null,
    fim: f.dateTo ? new Date(new Date(`${f.dateTo}T00:00:00-03:00`).getTime() + 86_400_000).toISOString() : null };
}
export function texto(value: unknown) { return String(value ?? "").trim(); }
export function numero(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
export function objeto(value: unknown): Record<string, unknown> {
  const v = Array.isArray(value) ? value[0] : value;
  return v && typeof v === "object" ? v as Record<string, unknown> : {};
}
export function dataHora(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
}
export function duracaoSegundos(inicio: string, fim: string): number | null {
  if (!inicio || !fim) return null;
  const ms = Date.parse(fim) - Date.parse(inicio);
  return Number.isFinite(ms) && ms >= 0 ? Math.floor(ms / 1000) : null;
}
export function duracaoTexto(segundos: number | null) {
  if (segundos == null) return "Sem apontamento";
  return `${Math.floor(segundos / 3600)}h ${String(Math.floor(segundos % 3600 / 60)).padStart(2, "0")}min ${String(segundos % 60).padStart(2, "0")}s`;
}

export type LinhaServico = {
  ordemId: number; servicoId: number; realizadorId: string; realizador: string; percentualAtual: number | null;
  setorRealizadorId: string; setorRealizador: string;
  setorId: string; setor: string; criadorId: string; criador: string; atribuidoPor: string;
  statusOS: string; cliente: string; descricao: string; complemento: string; quantidade: number;
  valorServico: number; baseComissao: number; percentualAplicado: number; comissao: number;
  situacao: string; inicio: string; fim: string; dataReferencia: string;
};
export function normalizarServico(raw: unknown, campoData: FiltrosServicos["campoData"]): LinhaServico {
  const r = objeto(raw), item = objeto(r.item), os = objeto(item.ordem), servico = objeto(item.servico);
  const usuario = objeto(r.usuario), setor = objeto(os.setor), criador = objeto(os.criador), setorRealizador = objeto(usuario.setor);
  const cliente = resolveOrdemCustomer(os.cliente ? objeto(os.cliente) : null, os.cliente_snapshot);
  const textos = resolverTextosServico(servico.descricao, item.descricao, `Serviço #${r.servicoid}`);
  return { ordemId: numero(r.ordemservicoid), servicoId: numero(r.servicoid), realizadorId: texto(r.usuarioid),
    realizador: texto(usuario.nome) || "Usuário não identificado", percentualAtual: usuario.comissao_percent == null ? null : numero(usuario.comissao_percent),
    setorRealizadorId: texto(usuario.setorid), setorRealizador: texto(setorRealizador.nome) || "Sem setor",
    setorId: texto(os.setorid), setor: texto(setor.nome) || "Sem setor", criadorId: texto(os.usuariocriadorid), criador: texto(criador.nome) || "Criador não identificado", atribuidoPor: "Não identificado",
    statusOS: texto(os.status), cliente: texto(cliente?.nomerazaosocial) || "Sem cliente", descricao: textos.descricao, complemento: textos.subdescricao ?? "",
    quantidade: numero(item.quantidade), valorServico: numero(item.subtotal), baseComissao: numero(r.valor_base),
    percentualAplicado: numero(r.comissao_percent_efetiva ?? r.comissao_percent_aplicada), comissao: numero(r.valor_comissao),
    situacao: texto(r.status_execucao) || "PENDENTE", inicio: texto(r.iniciado_em), fim: texto(r.finalizado_em),
    dataReferencia: texto(campoData === "servico" ? r.finalizado_em : campoData === "conclusao" ? os.execucao_fim_em : os.dataentrada) };
}

export type EventoAtribuicao = {
  id: number; ocorrido_em: string; operacao: string; usuario_id: string | null; ator_nome: string | null;
  dados_novos: unknown; dados_anteriores: unknown; usuario?: unknown;
};
export function chaveVinculo(r: Pick<LinhaServico, "ordemId" | "servicoId" | "realizadorId">) { return `${r.ordemId}:${r.servicoId}:${r.realizadorId}`; }
/** Somente INSERT cria autoria. DELETE invalida a atribuição, UPDATE nunca a substitui. */
export function autoresDasAtribuicoes(eventos: EventoAtribuicao[]) {
  const autores = new Map<string, { nome: string; criadoEm: string }>();
  for (const e of [...eventos].sort((a, b) => Date.parse(a.ocorrido_em) - Date.parse(b.ocorrido_em) || a.id - b.id)) {
    if (e.operacao !== "INSERT" && e.operacao !== "DELETE") continue;
    const r = objeto(e.operacao === "INSERT" ? e.dados_novos : e.dados_anteriores);
    if (!r.ordemservicoid || !r.servicoid || !r.usuarioid) continue;
    const chave = `${r.ordemservicoid}:${r.servicoid}:${r.usuarioid}`;
    if (e.operacao === "DELETE") { autores.delete(chave); continue; }
    // Não infere o autor pelo executor, nem reutiliza a autoria de um INSERT anterior.
    autores.set(chave, { nome: e.usuario_id ? texto(objeto(e.usuario).nome) || texto(e.ator_nome) || "Não identificado" : "Não identificado", criadoEm: texto(r.createdat) });
  }
  return autores;
}

export type TotaisServicos = { servicos: number; valor: number; base: number; comissao: number };
export function somarServicos(linhas: LinhaServico[]): TotaisServicos {
  const vistos = new Set<string>();
  let valor = 0, base = 0, comissao = 0;
  for (const l of linhas) {
    const chave = `${l.ordemId}:${l.servicoId}`;
    if (!vistos.has(chave)) { valor += Math.round(l.valorServico * 100); vistos.add(chave); }
    base += Math.round(l.baseComissao * 100); comissao += Math.round(l.comissao * 100);
  }
  return { servicos: vistos.size, valor: valor / 100, base: base / 100, comissao: comissao / 100 };
}
export type GrupoServicos = { id: string; nome: string; tipo: keyof typeof AGRUPAMENTOS; percentualAtual: number | null; totais: TotaisServicos; linhas: LinhaServico[]; filhos: GrupoServicos[] };
/** De onde cada agrupamento tira o identificador e o nome do grupo. */
const CAMPOS_DO_GRUPO = {
  realizador: { id: "realizadorId", nome: "realizador" },
  setor: { id: "setorId", nome: "setor" },
  setorRealizador: { id: "setorRealizadorId", nome: "setorRealizador" },
  criador: { id: "criadorId", nome: "criador" },
} as const satisfies Record<keyof typeof AGRUPAMENTOS, { id: keyof LinhaServico; nome: keyof LinhaServico }>;
const comparar = (a: string, b: string) => a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true });
export function agruparServicos(linhas: LinhaServico[], por: FiltrosServicos["agruparPor"]): GrupoServicos[] {
  const campos = CAMPOS_DO_GRUPO[por];
  const mapa = new Map<string, LinhaServico[]>();
  for (const l of linhas) {
    const id = texto(l[campos.id]);
    const lista = mapa.get(id) ?? []; lista.push(l); mapa.set(id, lista);
  }
  return [...mapa].map(([id, lista]) => {
    lista.sort((a, b) => (a.dataReferencia ? Date.parse(a.dataReferencia) : Infinity) - (b.dataReferencia ? Date.parse(b.dataReferencia) : Infinity) || a.ordemId - b.ordemId || a.servicoId - b.servicoId || comparar(a.realizadorId, b.realizadorId));
    const l = lista[0];
    // Só o agrupamento por realizador é folha; os outros abrem em realizadores,
    // que é onde a comissão de fato se fecha.
    return { id, nome: texto(l[campos.nome]), tipo: por, percentualAtual: por === "realizador" ? l.percentualAtual : null,
      totais: somarServicos(lista), linhas: lista, filhos: por === "realizador" ? [] : agruparServicos(lista, "realizador") };
  }).sort((a, b) => comparar(a.nome, b.nome) || comparar(a.id, b.id));
}
export function linhasOrdenadas(grupos: GrupoServicos[]): LinhaServico[] { return grupos.flatMap(g => g.filhos.length ? linhasOrdenadas(g.filhos) : g.linhas); }
export const NOTA_COMPARTILHADOS = "O valor integral aparece em cada participação. Os totais de setor, criador e geral contam cada serviço uma vez; a comissão soma apenas os realizadores incluídos nos filtros. Percentuais do cadastro são atuais; comissões e bases são as gravadas na OS.";
