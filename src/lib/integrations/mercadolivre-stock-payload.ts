export function buildStockOnlyPayload(quantity: number, variationId?: unknown) {
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error("Estoque inválido.");
  if (!variationId) return { available_quantity: quantity };
  const id = Number(variationId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Variação inválida.");
  return { variations: [{ id, available_quantity: quantity }] };
}
