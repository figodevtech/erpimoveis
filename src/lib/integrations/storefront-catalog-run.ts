import { syncStorefrontCatalog } from "@/lib/integrations/storefront-catalog";

/** A fila reserva as linhas e mantém alterações concorrentes para a próxima rodada. */
export async function runStorefrontCatalog(empresaId: number, options: {
  maxBatches?: number;
  budgetMs?: number;
} = {}) {
  const started = Date.now();
  const maxBatches = options.maxBatches ?? 25;
  const budgetMs = options.budgetMs ?? 240_000;
  let processed = 0;
  let categories = 0;
  let products = 0;
  let drained = false;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    if (Date.now() - started >= budgetMs) break;
    const result = await syncStorefrontCatalog(empresaId);
    processed += result.processed;
    categories = Math.max(categories, result.categories);
    products += result.products;
    if (result.processed === 0) {
      drained = true;
      break;
    }
  }
  return { processed, categories, products, drained };
}
