/** Topic names differ between legacy and current Mercado Livre subscriptions. */
export function normalizeMercadoLivreTopic(topic: string) {
  const value = String(topic ?? "").trim().toLowerCase();
  if (value === "user_products") return "user-products";
  if (value === "user_products_families") return "user-products-families";
  if (["stock-location", "stock_locations", "stock_location"].includes(value)) return "stock-locations";
  return value;
}

export function mercadoLivreFamilyHeaders(path: string): Record<string, string> {
  return /^\/sites\/GBL\/user-products-families\//i.test(path) ? { "X-API-Version": "2" } : {};
}
