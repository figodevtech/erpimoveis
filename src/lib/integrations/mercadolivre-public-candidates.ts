/** Only accept the documented resource, never an arbitrary URL from a webhook. */
export function publicCandidatePath(resource: string) {
  const match = /^\/seller-promotions\/candidates\/([A-Za-z0-9_-]+)(?:\?app_version=v2)?$/.exec(resource);
  if (!match) throw new Error("Recurso public_candidates inválido.");
  return `/seller-promotions/candidates/${match[1]}?app_version=v2`;
}

/** O candidato traz `status: { id }`; a lista de promoções do item, uma string. */
export function publicCandidateStatus(value: unknown) {
  const status = (value as { status?: unknown } | null)?.status;
  const id = typeof status === "object" && status ? (status as { id?: unknown }).id : status;
  return String(id ?? "").trim().toLowerCase();
}

/**
 * Convite para o anúncio entrar numa promoção. Nada é gravado: o preço só muda
 * se o vendedor aceitar, e aí quem avisa é `public_offers`.
 *
 * `get` devolve null para 404 — convite ou anúncio que sumiu é resposta, não
 * falha. Qualquer outro erro sobe para a fila de retentativa.
 */
export async function processPublicCandidate(
  resource: string,
  sellerId: number | string,
  get: (path: string) => Promise<unknown>,
) {
  const candidate = (await get(publicCandidatePath(resource))) as Record<string, any> | null;
  if (!candidate) return { candidate: null };
  const itemId = String(candidate.item_id ?? "");
  if (!/^ML[A-Z]\d+$/.test(itemId)) throw new Error("Candidato Mercado Livre sem item_id válido.");
  // Convite aceito, recusado ou vencido não pede ação de ninguém.
  if (publicCandidateStatus(candidate) !== "candidate") return { candidate };

  const item = (await get(`/items/${itemId}`)) as Record<string, any> | null;
  if (item && String(item.seller_id) !== String(sellerId)) {
    throw new Error("O anúncio do candidato não pertence à conta da notificação.");
  }
  // Nome, preço e quem paga o desconto só aparecem na lista de promoções do item.
  const promotions = await get(`/seller-promotions/items/${itemId}?app_version=v2`);
  const promotion = Array.isArray(promotions)
    ? promotions.find((entry) => entry?.ref_id === candidate.id)
      ?? promotions.find((entry) => candidate.promotion_id && entry?.id === candidate.promotion_id)
      ?? null
    : null;
  return { candidate, item, promotion };
}
