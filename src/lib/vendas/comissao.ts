/** Leitura do valor apurado no banco. Ausência nunca vira cálculo pelo cadastro atual. */
export type ComissaoVendaSnapshot = {
  usuarioid?: string | null;
  base: number;
  percentual: number;
  valor_comissao: number;
  integrada?: boolean;
};

export function lerComissaoVenda(value: unknown): ComissaoVendaSnapshot | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const base = Number(row.base);
  const percentual = Number(row.percentual);
  const valor = Number(row.valor_comissao);
  if (![base, percentual, valor].every(Number.isFinite)) return null;
  return { usuarioid: row.usuarioid == null ? null : String(row.usuarioid), base, percentual, valor_comissao: valor, integrada: row.integrada === true };
}
