export type ModalidadeImovel = "TEMPORADA" | "LOCACAO" | "VENDA";
export type TipoContaSite = "CLIENTE" | "PROPRIETARIO";
export type ImobList<T = Record<string, unknown>> = { items: T[]; total: number; page: number; pageSize: number };
export type CotacaoPublica = {
  available: boolean;
  nightlyBreakdown: Array<{ date: string; amount: number }>;
  subtotal: number;
  fees: number;
  taxes: number;
  total: number;
  currency: "BRL";
  quoteId?: string;
  expiresAt?: string;
};

export const IMOBILIARIO_BUCKET_FOTOS = "imoveis-fotos";
export const IMOBILIARIO_BUCKET_DOCUMENTOS = "imoveis-documentos";
export const IMOBILIARIO_TIMEZONE = "America/Fortaleza";

export function hojeImobiliario(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IMOBILIARIO_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function cotacaoPublica(row: Record<string, any>): CotacaoPublica {
  return {
    available: row.disponivel === true,
    nightlyBreakdown: (row.diarias ?? []).map((d: any) => ({ date: String(d.data), amount: Number(d.diaria) })),
    subtotal: Number(row.valor_diarias ?? 0), fees: Number(row.taxa_limpeza ?? 0), taxes: 0,
    total: Number(row.valor_total ?? 0), currency: "BRL",
    ...(row.cotacao_id ? { quoteId: String(row.cotacao_id) } : {}),
    ...(row.expira_em ? { expiresAt: String(row.expira_em) } : {}),
  };
}

export function statusReservaPublico(status: unknown) {
  return ({ CONFIRMADA: "CONFIRMED", EM_ANDAMENTO: "IN_PROGRESS", CONCLUIDA: "COMPLETED", CANCELADA: "CANCELLED" } as Record<string, string>)[String(status)] ?? "CONFIRMED";
}
