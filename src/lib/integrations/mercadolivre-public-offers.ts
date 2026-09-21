/** Only accept the documented resource, never an arbitrary URL from a webhook. */
export function publicOfferPath(resource: string) {
  const match = /^\/seller-promotions\/offers\/([A-Za-z0-9_-]+)(?:\?app_version=v2)?$/.exec(resource);
  if (!match) throw new Error("Recurso public_offers inválido.");
  return `/seller-promotions/offers/${match[1]}?app_version=v2`;
}

export async function processPublicOffer<T>(
  resource: string,
  getOffer: (path: string) => Promise<unknown>,
  syncItem: (itemId: string, offer: Record<string, unknown>) => Promise<T>,
): Promise<T> {
  const value = await getOffer(publicOfferPath(resource));
  const offer = value as Record<string, unknown> | null;
  const itemId = String(offer?.item_id ?? "");
  if (!/^ML[A-Z]\d+$/.test(itemId)) throw new Error("Oferta Mercado Livre sem item_id válido.");
  // Propagate API failures to the existing retry queue, including unavailable offers.
  return syncItem(itemId, offer!);
}
