// Regras de status e de contagem de dias do aluguel. Sem "use client": as rotas
// de API importam daqui para filtrar as abas pelo mesmo critério da tela.
//
// O banco grava só ATIVO, PAUSADO e ENCERRADO. "Agendado", "vence hoje" e
// "atrasado" são leituras das datas contra o dia de hoje em Fortaleza — o mesmo
// fuso de `public.aluguel_hoje()` na migration 20261013150000.
//
// `data_limite` nula é prazo indeterminado (20261013190000): nunca atrasa nem
// vence; a contagem passa a ser de dias em aberto desde o início.

export const FUSO_ALUGUEL = "America/Fortaleza";

/** Motivo das saídas de estoque do aluguel; a saída manual não pode usá-lo. */
export const MOTIVO_SAIDA_ALUGUEL = "ALUGUEL";

export const STATUS_ALUGUEL = ["ATIVO", "PAUSADO", "ENCERRADO"] as const;
export type StatusAluguel = (typeof STATUS_ALUGUEL)[number];

export type StatusExibicaoAluguel =
  | "AGENDADO"
  | "EM_ANDAMENTO"
  | "VENCE_HOJE"
  | "ATRASADO"
  | "PAUSADO"
  | "ENCERRADO";

export const ABAS_ALUGUEL = ["TODOS", "EM_ANDAMENTO", "ATRASADOS", "PAUSADOS", "ENCERRADOS"] as const;
export type AbaAluguel = (typeof ABAS_ALUGUEL)[number];

export const TIPOS_ITEM_ALUGUEL = ["PRODUTO", "USOCONSUMO", "GERAL", "VEICULO", "AVULSO"] as const;
export type TipoItemAluguel = (typeof TIPOS_ITEM_ALUGUEL)[number];

export type DatasDoAluguel = {
  status: StatusAluguel;
  data_inicio: string;
  /** Nula: prazo indeterminado. */
  data_limite: string | null;
  pausado_em?: string | null;
  encerrado_em?: string | null;
};

const MILISSEGUNDOS_POR_DIA = 86_400_000;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Dia (AAAA-MM-DD) de um instante, em Fortaleza. */
export function dataNoFuso(instante: Date | string): string {
  const data = typeof instante === "string" ? new Date(instante) : instante;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_ALUGUEL,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(data);
}

export function hojeAluguel(agora: Date = new Date()): string {
  return dataNoFuso(agora);
}

function paraDiaUtc(data: string): number {
  const dia = data.slice(0, 10);
  if (!DATA_ISO.test(dia)) throw new Error(`Data inválida: ${data}`);
  return Date.parse(`${dia}T00:00:00Z`);
}

/** Dias corridos de `de` até `ate` (negativo quando `ate` vem antes). */
export function diferencaEmDias(de: string, ate: string): number {
  return Math.round((paraDiaUtc(ate) - paraDiaUtc(de)) / MILISSEGUNDOS_POR_DIA);
}

export function somarDias(data: string, dias: number): string {
  return new Date(paraDiaUtc(data) + dias * MILISSEGUNDOS_POR_DIA).toISOString().slice(0, 10);
}

/** Duração combinada, em dias, entre o início e o limite. Prazo indeterminado: null. */
export function duracaoContratada(aluguel: Pick<DatasDoAluguel, "data_inicio" | "data_limite">): number | null {
  return aluguel.data_limite ? diferencaEmDias(aluguel.data_inicio, aluguel.data_limite) : null;
}

/** Dia em que a contagem para: a pausa, o retorno ou hoje. */
function diaDeReferencia(aluguel: DatasDoAluguel, hoje: string): string {
  if (aluguel.pausado_em && aluguel.status !== "ATIVO") return dataNoFuso(aluguel.pausado_em);
  if (aluguel.status === "ENCERRADO" && aluguel.encerrado_em) return dataNoFuso(aluguel.encerrado_em);
  return hoje;
}

/**
 * Dias até o limite; negativo é atraso. Pausado fica congelado no dia da pausa.
 * Encerrado não conta mais e prazo indeterminado não tem limite: null.
 */
export function diasRestantes(aluguel: DatasDoAluguel, hoje: string = hojeAluguel()): number | null {
  if (aluguel.status === "ENCERRADO" || !aluguel.data_limite) return null;
  return diferencaEmDias(diaDeReferencia(aluguel, hoje), aluguel.data_limite);
}

/** Dias desde o início até hoje, a pausa ou o retorno. Negativo: ainda não começou. */
export function diasEmAberto(aluguel: DatasDoAluguel, hoje: string = hojeAluguel()): number {
  return diferencaEmDias(aluguel.data_inicio, diaDeReferencia(aluguel, hoje));
}

/**
 * Encerrado: dias de atraso na devolução (0 = no prazo). Quem foi encerrado
 * pausado conta até a pausa, como `diasRestantes` (reiniciar limpa `pausado_em`,
 * então ele só sobrevive ao encerramento de um aluguel pausado). Aberto: null.
 */
export function diasDeAtrasoNaDevolucao(aluguel: DatasDoAluguel): number | null {
  if (aluguel.status !== "ENCERRADO" || !aluguel.encerrado_em) return null;
  // Sem limite não há atraso.
  if (!aluguel.data_limite) return 0;
  const referencia = dataNoFuso(aluguel.pausado_em || aluguel.encerrado_em);
  return Math.max(0, diferencaEmDias(aluguel.data_limite, referencia));
}

export function rotuloDevolucao(diasDeAtraso: number | null, prazoIndeterminado = false): string {
  if (diasDeAtraso === null) return "—";
  if (prazoIndeterminado) return "Devolvido";
  if (diasDeAtraso === 0) return "Devolvido no prazo";
  return `Devolvido com ${diasDeAtraso} ${diasDeAtraso === 1 ? "dia" : "dias"} de atraso`;
}

export function statusExibicao(aluguel: DatasDoAluguel, hoje: string = hojeAluguel()): StatusExibicaoAluguel {
  if (aluguel.status === "ENCERRADO") return "ENCERRADO";
  if (aluguel.status === "PAUSADO") return "PAUSADO";
  if (diferencaEmDias(hoje, aluguel.data_inicio) > 0) return "AGENDADO";
  if (!aluguel.data_limite) return "EM_ANDAMENTO";
  const restantes = diferencaEmDias(hoje, aluguel.data_limite);
  if (restantes < 0) return "ATRASADO";
  if (restantes === 0) return "VENCE_HOJE";
  return "EM_ANDAMENTO";
}

/** Reiniciar: a contagem volta a correr de hoje, com a mesma duração (ou sem limite). */
export function datasAoReiniciar(
  aluguel: Pick<DatasDoAluguel, "data_inicio" | "data_limite">,
  hoje: string = hojeAluguel(),
): { data_inicio: string; data_limite: string | null } {
  const duracao = duracaoContratada(aluguel);
  return { data_inicio: hoje, data_limite: duracao === null ? null : somarDias(hoje, duracao) };
}

/** "N dias em aberto", para o prazo indeterminado. */
export function rotuloDiasEmAberto(dias: number): string {
  if (dias < 0) return `Começa em ${-dias} ${dias === -1 ? "dia" : "dias"}`;
  return `${dias} ${dias === 1 ? "dia" : "dias"} em aberto`;
}

export const ROTULO_STATUS_ALUGUEL: Record<StatusExibicaoAluguel, string> = {
  AGENDADO: "Agendado",
  EM_ANDAMENTO: "Em andamento",
  VENCE_HOJE: "Vence hoje",
  ATRASADO: "Atrasado",
  PAUSADO: "Pausado",
  ENCERRADO: "Encerrado",
};

export const ROTULO_TIPO_ITEM_ALUGUEL: Record<TipoItemAluguel, string> = {
  PRODUTO: "Produto",
  USOCONSUMO: "Uso e consumo",
  GERAL: "Estoque geral",
  VEICULO: "Veículo",
  AVULSO: "Avulso",
};

export function rotuloDias(dias: number | null, status: StatusExibicaoAluguel): string {
  if (dias === null) return "—";
  if (status === "AGENDADO") return `${dias} ${dias === 1 ? "dia" : "dias"} de contrato`;
  if (dias < 0) return `${-dias} ${dias === -1 ? "dia" : "dias"} de atraso`;
  if (dias === 0) return "Vence hoje";
  return `${dias} ${dias === 1 ? "dia restante" : "dias restantes"}`;
}

export type PoliticaAluguel = {
  podeEditar: boolean;
  podeChecklistSaida: boolean;
  podeChecklistRetorno: boolean;
  podePausar: boolean;
  podeReiniciar: boolean;
  podeEncerrar: boolean;
  podeExcluir: boolean;
};

/** Ações permitidas por status gravado, antes das permissões do usuário. */
export function politicaAluguel(status: StatusAluguel): PoliticaAluguel {
  const aberto = status !== "ENCERRADO";
  return {
    podeEditar: aberto,
    podeChecklistSaida: aberto,
    podeChecklistRetorno: status === "ENCERRADO",
    podePausar: status === "ATIVO",
    podeReiniciar: aberto,
    podeEncerrar: aberto,
    podeExcluir: true,
  };
}

/** Critério de cada aba, aplicado pela API sobre as colunas gravadas. */
export type FiltroDaAba = {
  status?: StatusAluguel;
  /** Limite a partir deste dia ou sem limite (prazo indeterminado). */
  limiteDesde?: string;
  /** Limite antes deste dia; sem limite fica de fora. */
  limiteAntesDe?: string;
};

export function filtroDaAba(aba: AbaAluguel, hoje: string = hojeAluguel()): FiltroDaAba {
  switch (aba) {
    case "EM_ANDAMENTO":
      return { status: "ATIVO", limiteDesde: hoje };
    case "ATRASADOS":
      return { status: "ATIVO", limiteAntesDe: hoje };
    case "PAUSADOS":
      return { status: "PAUSADO" };
    case "ENCERRADOS":
      return { status: "ENCERRADO" };
    default:
      return {};
  }
}

export function parseAbaAluguel(valor: string | null | undefined): AbaAluguel {
  const aba = String(valor ?? "").toUpperCase();
  return (ABAS_ALUGUEL as readonly string[]).includes(aba) ? (aba as AbaAluguel) : "TODOS";
}
