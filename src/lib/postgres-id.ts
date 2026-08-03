export const POSTGRES_INTEGER_MAX = 2_147_483_647;

/**
 * Converte apenas IDs compatíveis com colunas `integer` do PostgreSQL.
 * Documentos fiscais, telefones e outros números longos não são IDs válidos.
 */
export function parsePostgresIntegerId(value: unknown): number | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) return null;
    value = normalized;
  }

  if (typeof value !== "number" && typeof value !== "string") return null;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > POSTGRES_INTEGER_MAX) {
    return null;
  }

  return parsed;
}
