import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { requireEmpresaId } from "@/lib/empresa-context";
import { getValidMercadoLivreAccount } from "@/lib/integrations/mercadolivre-account";
import { mercadoLivreApiGet } from "@/lib/integrations/mercadolivre";
import {
  disabledMercadoLivreListingTypeMessage,
  isMercadoLivreListingTypeEnabled,
  resolveMercadoLivreDefaultListingType,
} from "@/lib/integrations/mercadolivre-listing-validation";
import { computeMercadoLivreListingCosts } from "@/lib/integrations/mercadolivre-mercado-envios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MARKETPLACE_LISTING_TYPES = [
  { id: "gold_special", name: "Clássico" },
  { id: "gold_pro", name: "Premium" },
  { id: "free", name: "Grátis" },
];

type ListingType = {
  id?: string;
  name?: string;
  remaining_listings?: number | null;
};

type AvailableListingTypes = {
  available?: ListingType[];
};

type ListingAvailability = {
  available?: boolean;
  has_available_listings?: boolean;
  cause?: string;
  code?: string;
};

type ListingPrice = {
  currency_id?: string;
  listing_exposure?: string;
  listing_fee_amount?: number;
  listing_type_id?: string;
  listing_type_name?: string;
  requires_picture?: boolean;
  sale_fee_amount?: number;
  sale_fee_details?: {
    financing_add_on_fee?: number;
    fixed_fee?: number;
    gross_amount?: number;
    percentage_fee?: number;
  };
};

type PaymentMethod = {
  id?: string;
  name?: string;
  payment_type_id?: string;
  status?: string;
};

type SellerProfile = {
  tags?: string[];
  user_type?: string;
  status?: {
    site_status?: string;
    list?: { allow?: boolean; codes?: string[]; immediate_payment?: { required?: boolean } };
    buy?: { allow?: boolean; codes?: string[] };
    billing?: { allow?: boolean; codes?: string[] };
    mercadopago_account_type?: string;
  };
  seller_reputation?: { power_seller_status?: string | null; level_id?: string | null };
};

export async function GET(req: NextRequest) {
  try {
    await requireVendasAccess();
    const empresaId = await requireEmpresaId();
    const account = await getValidMercadoLivreAccount(empresaId);
    const siteId = account.site_id || "MLB";
    const categoryId = String(req.nextUrl.searchParams.get("categoryId") ?? "").trim().toUpperCase();
    const price = Number(req.nextUrl.searchParams.get("price"));
    const shippingMode = String(req.nextUrl.searchParams.get("shippingMode") ?? "").trim().toLowerCase();
    const logisticType = String(req.nextUrl.searchParams.get("logisticType") ?? "").trim().toLowerCase();
    const sellerShippingCost = Number(req.nextUrl.searchParams.get("sellerShippingCost"));

    const [siteListingTypes, seller, paymentMethods] = await Promise.all([
      mercadoLivreApiGet<ListingType[]>(account.access_token, `/sites/${encodeURIComponent(siteId)}/listing_types`)
        .catch(() => mercadoLivrePublicGet<ListingType[]>(`/sites/${encodeURIComponent(siteId)}/listing_types`))
        .catch(() => []),
      mercadoLivreApiGet<SellerProfile>(account.access_token, `/users/${account.ml_user_id}`),
      mercadoLivreApiGet<PaymentMethod[]>(account.access_token, `/users/${account.ml_user_id}/accepted_payment_methods`).catch(() => []),
    ]);

    const baseTypes = normalizeSiteListingTypes(siteListingTypes);
    const availability = categoryId
      ? await mercadoLivreApiGet<AvailableListingTypes>(
          account.access_token,
          `/users/${account.ml_user_id}/available_listing_types?category_id=${encodeURIComponent(categoryId)}`,
        ).catch(() => null)
      : null;
    const availableById = new Map((availability?.available ?? []).filter((item) => item.id).map((item) => [String(item.id), item]));
    const hasCategoryAvailability = Boolean(availability && Array.isArray(availability.available));
    const candidateTypes = mergeListingTypes(baseTypes, availability?.available ?? []);

    const unavailableTypes = hasCategoryAvailability
      ? candidateTypes.filter((item) => isMercadoLivreListingTypeEnabled(item.id) && !availableById.has(item.id))
      : [];
    const unavailableDetails = new Map<string, ListingAvailability>();
    if (categoryId && unavailableTypes.length) {
      const details = await Promise.all(
        unavailableTypes.map(async (item) => {
          const detail = await mercadoLivreApiGet<ListingAvailability>(
            account.access_token,
            `/users/${account.ml_user_id}/available_listing_type/${encodeURIComponent(item.id)}?category_id=${encodeURIComponent(categoryId)}`,
          ).catch(() => null);
          return [item.id, detail] as const;
        }),
      );
      for (const [id, detail] of details) if (detail) unavailableDetails.set(id, detail);
    }

    const feeByType = new Map<string, ListingPrice>();
    if (categoryId && Number.isFinite(price) && price > 0) {
      const fees = await Promise.all(
        candidateTypes.map(async (item) => {
          if (!isMercadoLivreListingTypeEnabled(item.id)) return [item.id, null] as const;
          if (hasCategoryAvailability && !availableById.has(item.id)) return [item.id, null] as const;
          const params = new URLSearchParams({
            price: String(price),
            currency_id: "BRL",
            category_id: categoryId,
            listing_type_id: item.id,
          });
          if (shippingMode) params.set("shipping_mode", shippingMode);
          if (logisticType) params.set("logistic_type", logisticType);
          // `billable_weight` é documentado como obrigatório apenas na Argentina; no
          // Brasil a lógica de cálculo informa que o peso faturável não se aplica.
          const path = `/sites/${encodeURIComponent(siteId)}/listing_prices?${params.toString()}`;
          const raw = await mercadoLivreApiGet<ListingPrice | ListingPrice[]>(account.access_token, path)
            .catch(() => mercadoLivrePublicGet<ListingPrice | ListingPrice[]>(path))
            .catch(() => null);
          const fee = Array.isArray(raw) ? raw.find((entry) => entry.listing_type_id === item.id) ?? raw[0] : raw;
          return [item.id, fee ?? null] as const;
        }),
      );
      for (const [id, fee] of fees) if (fee) feeByType.set(id, fee);
    }

    const listingTypes = candidateTypes.map((item) => {
      const availableItem = availableById.get(item.id);
      const detail = unavailableDetails.get(item.id);
      const fee = feeByType.get(item.id);
      // `sale_fee_amount` já é o custo total por vender e contém `fixed_fee`.
      // A taxa fixa aparece apenas como detalhamento e nunca é somada de novo.
      const costs = computeMercadoLivreListingCosts({
        price: Number.isFinite(price) ? price : 0,
        saleFeeAmount: fee?.sale_fee_amount ?? null,
        fixedFee: fee?.sale_fee_details?.fixed_fee ?? null,
        percentageFee: fee?.sale_fee_details?.percentage_fee ?? null,
        financingFee: fee?.sale_fee_details?.financing_add_on_fee ?? null,
        sellerShippingCost: Number.isFinite(sellerShippingCost) && sellerShippingCost > 0 ? sellerShippingCost : null,
      });
      const saleFee = costs.marketplaceCost;
      const percentage = costs.percentageFee ?? (saleFee != null && Number.isFinite(price) && price > 0
        ? Number(((saleFee / price) * 100).toFixed(2))
        : null);
      const financingFee = costs.financingFee;
      const fixedFee = costs.fixedFee;
      const quotaExhausted = item.id === "free" && availableItem?.remaining_listings != null && availableItem.remaining_listings <= 0;
      const systemEnabled = isMercadoLivreListingTypeEnabled(item.id);
      const isAvailable = systemEnabled && (!hasCategoryAvailability || Boolean(availableItem)) && !quotaExhausted;
      return {
        id: item.id,
        name: localizedListingTypeName(item.id, availableItem?.name || item.name),
        available: isAvailable,
        remainingListings: availableItem?.remaining_listings ?? null,
        restrictionCode: isAvailable ? null : detail?.code ?? null,
        restrictionReason: !systemEnabled
          ? disabledMercadoLivreListingTypeMessage
          : isAvailable
            ? null
            : quotaExhausted
            ? "A cota de anúncios grátis desta conta foi atingida."
            : translateAvailabilityCause(detail?.cause, detail?.code),
        saleFee,
        saleFeePercentage: percentage,
        financingFee,
        fixedFee,
        netAmount: costs.estimatedNetAmount,
        sellerShippingCost: costs.sellerShippingCost,
        currencyId: fee?.currency_id ?? "BRL",
        exposure: fee?.listing_exposure ?? null,
        requiresPicture: fee?.requires_picture ?? true,
        interestFreeInstallments: item.id === "gold_pro",
        paymentDescription: paymentDescription(item.id),
      };
    });

    const sellerTags = Array.isArray(seller.tags) ? seller.tags.map(String) : [];
    const listAllowed = seller.status?.list?.allow !== false;
    const listingCodes = seller.status?.list?.codes ?? [];
    const activeTypes = listingTypes.filter((item) => item.available);
    const preferredListingTypeId = account.default_listing_type_id || "gold_special";
    const defaultListingTypeId = resolveMercadoLivreDefaultListingType(
      preferredListingTypeId,
      activeTypes.map((item) => item.id),
    );

    return NextResponse.json({
      listingTypes,
      source: hasCategoryAvailability ? "account-category" : baseTypes.length ? "account" : "fallback",
      defaultListingTypeId,
      preferredListingTypeId,
      seller: {
        canList: listAllowed,
        restrictions: listingCodes.map(translateSellerStatusCode),
        accountType: seller.status?.mercadopago_account_type ?? seller.user_type ?? null,
        reputationLevel: seller.seller_reputation?.level_id ?? null,
        powerSellerStatus: seller.seller_reputation?.power_seller_status ?? null,
        immediatePaymentRequired: seller.status?.list?.immediate_payment?.required ?? null,
      },
      payment: {
        managedByMercadoPago: true,
        methods: normalizePaymentMethods(paymentMethods),
        note: "As formas disponíveis são definidas pelo Mercado Pago no checkout do comprador.",
      },
      sellerTags,
      userProductSeller: sellerTags.includes("user_product_seller"),
    });
  } catch (error: any) {
    console.error("GET /api/integracoes/mercadolivre/listing-options", error);
    return NextResponse.json(
      { error: friendlyError(error) || "Falha ao consultar as condições comerciais da conta Mercado Livre." },
      { status: Number(error?.status) || 500 },
    );
  }
}

function normalizeSiteListingTypes(types: ListingType[]) {
  const marketplaceIds = new Set(MARKETPLACE_LISTING_TYPES.map((item) => item.id));
  const normalized = (types ?? [])
    .filter((item) => item.id && marketplaceIds.has(String(item.id)))
    .map((item) => ({ id: String(item.id), name: localizedListingTypeName(String(item.id), item.name) }));
  return normalized.length ? normalized : MARKETPLACE_LISTING_TYPES;
}

function mergeListingTypes(base: Array<{ id: string; name: string }>, available: ListingType[]) {
  const result = new Map(base.map((item) => [item.id, item]));
  for (const item of available) {
    if (!item.id) continue;
    result.set(String(item.id), { id: String(item.id), name: localizedListingTypeName(String(item.id), item.name) });
  }
  return Array.from(result.values());
}

function localizedListingTypeName(id: string, fallback?: string) {
  if (id === "gold_pro") return "Premium";
  if (id === "gold_special") return "Clássico";
  if (id === "free") return "Grátis";
  return fallback || id;
}

function paymentDescription(id: string) {
  if (id === "gold_pro") return "Parcelamento sem juros; quantidade de parcelas definida pelo Mercado Livre conforme preço e meio de pagamento.";
  if (id === "free") return "Sem benefício de parcelamento sem juros e com exposição limitada.";
  return "Parcelamento com juros do comprador, conforme condições do Mercado Pago.";
}

function normalizePaymentMethods(methods: PaymentMethod[]) {
  const active = (Array.isArray(methods) ? methods : []).filter((method) => !method.status || method.status === "active");
  const grouped = new Map<string, string>();
  for (const method of active) {
    const type = String(method.payment_type_id || method.id || "outros");
    const label = paymentTypeLabel(type, method.name);
    if (!grouped.has(type)) grouped.set(type, label);
  }
  return Array.from(grouped, ([id, name]) => ({ id, name }));
}

function paymentTypeLabel(type: string, fallback?: string) {
  const labels: Record<string, string> = {
    credit_card: "Cartão de crédito",
    debit_card: "Cartão de débito",
    bank_transfer: "Pix ou transferência",
    account_money: "Saldo Mercado Pago",
    ticket: "Boleto",
    digital_currency: "Saldo digital",
  };
  return labels[type] || fallback || type;
}

function translateSellerStatusCode(code: string) {
  const labels: Record<string, string> = {
    identification_pending: "Validação de identidade pendente.",
    identification_required: "É necessário validar a identidade da conta.",
    contact_data_pending: "Complete os dados de contato da conta.",
    user_not_allowed_to_list: "A conta não está autorizada a publicar anúncios.",
  };
  return labels[String(code).toLowerCase()] || `Restrição da conta: ${code}.`;
}

function translateAvailabilityCause(cause?: string, code?: string) {
  const normalizedCode = String(code ?? "").toLowerCase();
  if (normalizedCode.includes("transactions.exceeded")) return "O limite de vendas permitido para anúncios grátis foi ultrapassado.";
  if (normalizedCode.includes("feedback.not_allowed")) return "A reputação atual da conta não permite este tipo de anúncio.";
  if (normalizedCode.includes("listings.exceeded")) return "A cota de anúncios deste tipo foi atingida.";
  if (cause && /[ãõáéíóúç]|\b(não|conta|anúncio|vendas?)\b/i.test(cause)) return cause;
  return "Este tipo de anúncio não está disponível para a conta e categoria selecionadas.";
}


async function mercadoLivrePublicGet<T>(path: string) {
  const response = await fetch(`https://api.mercadolibre.com${path}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Mercado Livre ${path} falhou (${response.status}).`);
  return (await response.json()) as T;
}

function friendlyError(error: any) {
  const message = String(error?.message ?? "");
  if (message.includes("invalid access token")) return "A autorização do Mercado Livre expirou. Reconecte a conta.";
  if (message.includes("PA_UNAUTHORIZED") || message.toLowerCase().includes("forbidden")) {
    return "A conta conectada não autorizou a consulta das condições comerciais.";
  }
  return message;
}
