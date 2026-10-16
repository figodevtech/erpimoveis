/**
 * CFOP de escrituração das entradas.
 *
 * O XML recebido traz o CFOP do emitente (5xxx/6xxx). Na EFD, o C170/C190 de
 * entrada leva o CFOP do destinatário (1xxx/2xxx/3xxx), e o PVA recusa CFOP de
 * saída num documento com IND_OPER = 0. A tabela abaixo só cobre conversões em
 * que o CFOP de entrada decorre do CFOP do emitente e da destinação da
 * mercadoria. Fora dela, a conversão fica pendente para revisão fiscal.
 */
export type SpedEntryPurpose = "REVENDA" | "USO_CONSUMO" | "ATIVO_IMOBILIZADO";

type PurposeMap = Partial<Record<SpedEntryPurpose, string>> | string;

const SALE = { REVENDA: "102", USO_CONSUMO: "556", ATIVO_IMOBILIZADO: "551" } as const;
const SALE_ST = { REVENDA: "403", USO_CONSUMO: "407", ATIVO_IMOBILIZADO: "406" } as const;

/** Sufixo do CFOP do emitente -> sufixo do CFOP de entrada. */
const SUFFIX_MAP: Record<string, PurposeMap> = {
  // Vendas de produção própria ou de mercadoria de terceiros.
  "101": SALE, "102": SALE, "103": SALE, "104": SALE, "105": SALE, "106": SALE,
  "107": SALE, "108": SALE, "109": SALE, "110": SALE, "111": SALE, "113": SALE,
  "116": SALE, "117": SALE, "118": SALE, "119": SALE, "120": SALE, "122": SALE,
  "123": SALE,
  // Vendas com mercadoria sujeita a substituição tributária.
  "401": SALE_ST, "402": SALE_ST, "403": SALE_ST, "405": SALE_ST,
  // Venda de bem do ativo pelo emitente.
  "551": SALE,
  // Transferências entre estabelecimentos.
  "151": { REVENDA: "151" },
  "152": { REVENDA: "152", USO_CONSUMO: "557", ATIVO_IMOBILIZADO: "552" },
  "409": { REVENDA: "409" },
  // Devolução pelo cliente de mercadoria que vendemos.
  "201": { REVENDA: "202" }, "202": { REVENDA: "202" }, "411": { REVENDA: "411" },
  // Operações cujo CFOP de entrada espelha o do emitente, qualquer que seja a destinação.
  "901": "901", "902": "902", "903": "903", "908": "908", "909": "909",
  "910": "910", "911": "911", "912": "912", "913": "913", "915": "915",
  "916": "916", "920": "920", "921": "921", "933": "933", "949": "949",
};

const PREFIX: Record<string, string> = { "5": "1", "6": "2", "7": "3" };

export type SpedEntryCfopResolution =
  | { cfop: string; reason: null }
  | { cfop: null; reason: "CFOP_INVALIDO" | "CFOP_NAO_E_SAIDA" | "DESTINACAO_DESCONHECIDA" | "SEM_REGRA" };

export function resolveEntryCfop(supplierCfop: unknown, purpose: SpedEntryPurpose | null): SpedEntryCfopResolution {
  const cfop = String(supplierCfop ?? "").replace(/\D/g, "");
  if (!/^\d{4}$/.test(cfop)) return { cfop: null, reason: "CFOP_INVALIDO" };
  const prefix = PREFIX[cfop[0]];
  if (!prefix) return { cfop: null, reason: "CFOP_NAO_E_SAIDA" };
  const rule = SUFFIX_MAP[cfop.slice(1)];
  if (!rule) return { cfop: null, reason: "SEM_REGRA" };
  if (typeof rule === "string") return { cfop: `${prefix}${rule}`, reason: null };
  if (!purpose) return { cfop: null, reason: "DESTINACAO_DESCONHECIDA" };
  const suffix = rule[purpose];
  return suffix ? { cfop: `${prefix}${suffix}`, reason: null } : { cfop: null, reason: "SEM_REGRA" };
}

/** Destinação da mercadoria a partir da decisão de crédito ou do tipo do item (0200). */
export function entryPurposeFor(input: { creditTreatment?: string | null; itemType?: string | null }): SpedEntryPurpose | null {
  if (input.creditTreatment === "USO_CONSUMO") return "USO_CONSUMO";
  if (input.creditTreatment === "ATIVO_IMOBILIZADO") return "ATIVO_IMOBILIZADO";
  if (input.itemType === "00") return "REVENDA";
  if (input.itemType === "07") return "USO_CONSUMO";
  if (input.itemType === "08") return "ATIVO_IMOBILIZADO";
  return null;
}
