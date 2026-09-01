export type MercadoLivreQuantityTier = {
  quantity: number;
  percentage: number;
};

export function validateMercadoLivreQuantityTiers(value: unknown): MercadoLivreQuantityTier[] {
  if (!Array.isArray(value)) throw quantityError("Informe as faixas de preço por quantidade.");
  if (value.length > 5) throw quantityError("O Mercado Livre permite no máximo 5 faixas de preço por quantidade.");

  const tiers = value.map((entry: any) => ({
    quantity: Math.trunc(Number(entry?.quantity)),
    percentage: Number(Number(entry?.percentage).toFixed(4)),
  }));
  let previousQuantity = 0;
  let previousPercentage = 0;
  for (const tier of tiers) {
    if (!Number.isInteger(tier.quantity) || tier.quantity < 1 || tier.quantity > 100) {
      throw quantityError("Cada quantidade mínima deve ser um número inteiro entre 1 e 100.");
    }
    if (!Number.isFinite(tier.percentage) || tier.percentage <= 0 || tier.percentage >= 100) {
      throw quantityError("Cada desconto deve ser maior que 0% e menor que 100%.");
    }
    if (tier.quantity <= previousQuantity) throw quantityError("As quantidades mínimas devem estar em ordem crescente.");
    if (tier.percentage <= previousPercentage) throw quantityError("O desconto deve aumentar em cada nova faixa de quantidade.");
    previousQuantity = tier.quantity;
    previousPercentage = tier.percentage;
  }
  return tiers;
}

export function buildMercadoLivreQuantityPricePayload(tiers: MercadoLivreQuantityTier[]) {
  return {
    price_per_quantity: tiers.map((tier) => ({
      type: "discount_percentage",
      percentage: tier.percentage,
      conditions: {
        context_restrictions: ["channel_marketplace", "user_type_business"],
        min_purchase_unit: tier.quantity,
        eligible: true,
      },
    })),
  };
}

function quantityError(message: string) {
  const error = new Error(message);
  (error as any).status = 422;
  return error;
}
