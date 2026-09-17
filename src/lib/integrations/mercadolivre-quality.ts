/**
 * Qualidade do anúncio como fração de 0 a 1, que é o que a coluna `health` guarda.
 *
 * O campo `health` do item vem da API /health, que o Mercado Livre descontinuou
 * em fevereiro de 2025, e hoje volta nulo. Como o vínculo mantinha o último valor
 * quando ele vinha nulo, o ERP ficou mostrando uma nota antiga. A nota que o
 * vendedor vê no Mercado Livre é `score` (0 a 100) em `/item/{id}/performance`,
 * que para anúncio de User Product já responde com a nota do User Product.
 * O campo legado só vale enquanto a nota nova ainda não foi calculada.
 */
export function mercadoLivreListingHealth(performance: unknown, legacyHealth?: unknown) {
  const score = finiteNumber((performance as { score?: unknown } | null | undefined)?.score);
  if (score != null) return Math.min(Math.max(score, 0), 100) / 100;
  return finiteNumber(legacyHealth);
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
