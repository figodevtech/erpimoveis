type Row = Record<string, any>;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * Fuso IANA por UF. Só entram UFs com um único fuso civil: ali o fuso decorre
 * do endereço sem ambiguidade. O Amazonas tem municípios em UTC-5 e fica de
 * fora; em Pernambuco, Fernando de Noronha tem fuso próprio e é reconhecido
 * pelo código IBGE.
 */
const SINGLE_TIMEZONE_BY_UF: Record<string, string> = {
  AC: "America/Rio_Branco",
  AL: "America/Maceio",
  AP: "America/Belem",
  BA: "America/Bahia",
  CE: "America/Fortaleza",
  DF: "America/Sao_Paulo",
  ES: "America/Sao_Paulo",
  GO: "America/Sao_Paulo",
  MA: "America/Fortaleza",
  MG: "America/Sao_Paulo",
  MS: "America/Campo_Grande",
  MT: "America/Cuiaba",
  PA: "America/Belem",
  PB: "America/Fortaleza",
  PI: "America/Fortaleza",
  PR: "America/Sao_Paulo",
  RJ: "America/Sao_Paulo",
  RN: "America/Fortaleza",
  RO: "America/Porto_Velho",
  RR: "America/Boa_Vista",
  RS: "America/Sao_Paulo",
  SC: "America/Sao_Paulo",
  SE: "America/Maceio",
  SP: "America/Sao_Paulo",
  TO: "America/Araguaina",
};

const FERNANDO_DE_NORONHA_IBGE = "2605459";

export function deriveTimezoneFromAddress(uf: unknown, municipalityCode: unknown): { timezone: string; evidence: string } | null {
  const state = text(uf).toUpperCase();
  const municipality = text(municipalityCode).replace(/\D/g, "");
  if (state === "PE") {
    return municipality === FERNANDO_DE_NORONHA_IBGE
      ? { timezone: "America/Noronha", evidence: "Derivado do município (Fernando de Noronha, IBGE 2605459)" }
      : { timezone: "America/Recife", evidence: `Derivado da UF PE (município IBGE ${municipality || "não informado"} fora de Fernando de Noronha)` };
  }
  const timezone = SINGLE_TIMEZONE_BY_UF[state];
  return timezone ? { timezone, evidence: `Derivado da UF ${state}, que possui um único fuso civil` } : null;
}

const CSOSN_CODES = new Set(["101", "102", "103", "201", "202", "203", "300", "400", "500", "900"]);

export type SpedFiscalPolicies = {
  resaleCreditConfirmed: boolean;
  /** Política confirmada: true gera crédito, false não gera. Null: ainda não decidida. */
  resaleCredit: boolean | null;
  csosnToCst: Record<string, string> | null;
};

/** Políticas confirmadas pelo contador, guardadas nas evidências da configuração. */
export function readSpedPolicies(config: Row | null | undefined): SpedFiscalPolicies {
  const evidence = (config?.evidencias ?? {}) as Row;
  const credit = evidence.politica_credito_revenda as Row | undefined;
  const csosn = evidence.politica_csosn_entrada as Row | undefined;
  const map = csosn?.status === "CONFIRMADO" && csosn?.mapa && typeof csosn.mapa === "object"
    ? Object.fromEntries(Object.entries(csosn.mapa as Row)
      .filter(([key, value]) => CSOSN_CODES.has(key) && /^\d{2}$/.test(text(value)))
      .map(([key, value]) => [key, text(value)]))
    : null;
  return {
    resaleCreditConfirmed: credit?.status === "CONFIRMADO" && credit?.aplicavel === true,
    resaleCredit: credit?.status === "CONFIRMADO" && typeof credit?.aplicavel === "boolean" ? credit.aplicavel : null,
    csosnToCst: map && Object.keys(map).length > 0 ? map : null,
  };
}

/** Valida e normaliza o patch das políticas antes de gravar. Lança com mensagem clara. */
export function normalizePolicyPatch(patch: unknown, actorId: string): Row {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return {};
  const input = patch as Row;
  const output: Row = {};
  const now = new Date().toISOString();
  if (input.creditoRevenda !== undefined) {
    const value = input.creditoRevenda as Row;
    const descricao = text(value?.descricao);
    if (typeof value?.aplicavel !== "boolean") throw new Error("Informe se as compras para revenda geram crédito de ICMS.");
    if (!descricao) throw new Error("Informe a evidência da política de crédito (ex.: regime de apuração confirmado pelo contador).");
    output.politica_credito_revenda = { status: "CONFIRMADO", aplicavel: value.aplicavel, descricao, origem: origin(value.origem), confirmadoEm: now, confirmadoPor: actorId };
  }
  if (input.csosnEntrada !== undefined) {
    const value = input.csosnEntrada as Row;
    const descricao = text(value?.descricao);
    const mapa = value?.mapa && typeof value.mapa === "object" ? value.mapa as Row : {};
    const invalid = Object.entries(mapa).filter(([key, cst]) => !CSOSN_CODES.has(key) || !/^\d{2}$/.test(text(cst)));
    if (invalid.length) throw new Error(`De-para CSOSN→CST inválido: ${invalid.map(([key]) => key).join(", ")}.`);
    if (!descricao) throw new Error("Informe a evidência do de-para CSOSN→CST.");
    output.politica_csosn_entrada = { status: "CONFIRMADO", mapa, descricao, origem: origin(value.origem), confirmadoEm: now, confirmadoPor: actorId };
  }
  return output;
}

/** Sem origem informada, a política veio da tela técnica do contador. */
function origin(value: unknown): "AUTOMATICA" | "RESPOSTA" | "CONTADOR" {
  const text = String(value ?? "");
  return text === "AUTOMATICA" || text === "RESPOSTA" ? text : "CONTADOR";
}

export type SpedConfigVigencia = { vigencia_inicio: string; payload: Row };

/**
 * Configuração vigente na competência: a vigência mais recente que começou até
 * o primeiro dia dela. Antes da primeira vigência registrada vale a mais antiga
 * (a configuração anterior ao histórico). Sem histórico, a corrente.
 */
export function effectiveSpedConfig(
  competenceStart: string,
  vigencias: readonly SpedConfigVigencia[],
  current: Row | null,
): Row | null {
  const sorted = [...vigencias].sort((left, right) => text(left.vigencia_inicio).localeCompare(text(right.vigencia_inicio)));
  const applicable = sorted.filter((row) => text(row.vigencia_inicio).slice(0, 10) <= competenceStart).pop() ?? sorted[0];
  if (!applicable) return current;
  return { ...applicable.payload, vigencia_inicio: text(applicable.vigencia_inicio).slice(0, 10) };
}
