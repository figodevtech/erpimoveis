import { NextResponse } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { mercadoLivreApiGet } from "@/lib/integrations/mercadolivre";
import { getValidMercadoLivreAccount } from "@/lib/integrations/mercadolivre-account";
import {
  buildMercadoLivreItemPayload,
  collectMercadoLivreListingRequestErrors,
  formatMercadoLivreError,
  parseMercadoLivreListingRequest,
  parsePictureUrls,
  runMercadoLivreItemValidation,
} from "@/lib/integrations/mercadolivre-item-payload";
import {
  buildMercadoLivreShippingDimensions,
  computeMercadoLivreListingCosts,
  MERCADO_ENVIOS_MESSAGES,
  mercadoEnviosLogisticLabel,
} from "@/lib/integrations/mercadolivre-mercado-envios";
import { logMercadoLivreListingPayload } from "@/lib/integrations/mercadolivre-listing-payload-log";
import { resolveMercadoEnviosForListing } from "@/lib/integrations/mercadolivre-shipping-preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MercadoLivreSeller = {
  tags?: string[];
  status?: { list?: { allow?: boolean; codes?: string[] } };
};

type ListingPrice = {
  currency_id?: string;
  listing_fee_amount?: number;
  sale_fee_amount?: number;
  sale_fee_details?: {
    financing_add_on_fee?: number;
    fixed_fee?: number;
    gross_amount?: number;
    percentage_fee?: number;
  };
};

type CheckStatus = "ok" | "warning" | "error" | "skipped";
type Check = { id: string; label: string; status: CheckStatus; detail: string | null };

/**
 * Etapa "Validar anúncio": monta exatamente o payload que iria para `POST /items`,
 * consulta o Mercado Envios, os custos de venda e submete a
 * `POST /items/validate`. Nada é publicado aqui.
 */
export async function POST(req: Request) {
  try {
    await requireVendasAccess();
    const empresaId = await requireEmpresaId();
    const body = await req.json().catch(() => ({}));
    const request = parseMercadoLivreListingRequest(body);

    const checks: Check[] = [];
    const requestErrors = collectMercadoLivreListingRequestErrors(request, { requireProduto: false });
    const fieldErrors: Record<string, string> = Object.fromEntries(
      requestErrors.map((issue) => [issue.field, issue.message]),
    );

    checks.push({
      id: "form",
      label: "Dados do anúncio",
      status: requestErrors.length ? "error" : "ok",
      detail: requestErrors.length ? requestErrors.map((issue) => issue.message).join(" ") : null,
    });

    if (requestErrors.length) {
      return NextResponse.json({
        data: {
          state: "invalid",
          checks,
          fieldErrors,
          errors: requestErrors.map((issue) => issue.message),
          warnings: [],
          shipping: null,
          costs: null,
        },
      });
    }

    const account = await getValidMercadoLivreAccount(empresaId);
    const seller = await mercadoLivreApiGet<MercadoLivreSeller>(account.access_token, `/users/${account.ml_user_id}`).catch(
      () => null,
    );
    const sellerTags = Array.isArray(seller?.tags) ? seller.tags.map(String) : [];
    const userProductSeller = sellerTags.includes("user_product_seller");
    const sellerBlocked = seller?.status?.list?.allow === false;

    checks.push({
      id: "seller",
      label: "Conta vendedora",
      status: seller ? (sellerBlocked ? "error" : "ok") : "warning",
      detail: sellerBlocked
        ? `A conta Mercado Livre não está autorizada a publicar. ${(seller?.status?.list?.codes ?? []).join(", ")}`.trim()
        : seller
          ? null
          : "Não foi possível confirmar a situação da conta vendedora.",
    });
    if (sellerBlocked) fieldErrors.general = checks[checks.length - 1].detail ?? "";

    const { payload, attributes, saleTerms } = buildMercadoLivreItemPayload({
      ...request,
      pictures: parsePictureUrls(request.pictureUrl).map((source) => ({ source })),
      userProductSeller,
    });

    const requiresMercadoEnvios = request.shippingMode === "me2";
    const shipping = requiresMercadoEnvios
      ? await resolveMercadoEnviosForListing(account, {
          context: {
            title: request.title,
            categoryId: request.categoryId,
            price: request.price,
            currencyId: "BRL",
            listingTypeId: request.listingTypeId,
            condition: request.condition,
            localPickup: request.localPickup,
            dimensions: buildMercadoLivreShippingDimensions(request),
            saleTerms,
            attributes,
          },
          lengthCm: request.lengthCm,
          widthCm: request.widthCm,
          heightCm: request.heightCm,
          weightGrams: request.weightGrams,
          preferredLogisticType: request.logisticType,
        }).catch((error) => {
          console.error("mercado-envios validation", error);
          return null;
        })
      : null;

    const logisticAvailable = Boolean(
      shipping?.available && shipping.logistics.some((option) => option.type === request.logisticType.toLowerCase()),
    );

    if (requiresMercadoEnvios) {
      checks.push({
        id: "mercado_envios",
        label: "Mercado Envios disponível",
        status: shipping?.available ? "ok" : "error",
        detail: shipping?.available ? null : shipping?.message ?? MERCADO_ENVIOS_MESSAGES.quoteFailed,
      });
      checks.push({
        id: "logistic",
        label: "Logística confirmada",
        status: logisticAvailable ? "ok" : shipping?.available ? "error" : "skipped",
        detail: logisticAvailable
          ? mercadoEnviosLogisticLabel(request.logisticType)
          : shipping?.available
            ? `${MERCADO_ENVIOS_MESSAGES.logisticUnavailable} Opções: ${
                shipping.logistics.map((option) => option.type).join(", ") || "nenhuma"
              }.`
            : null,
      });

      if (!shipping?.available) fieldErrors.shipping = shipping?.message ?? MERCADO_ENVIOS_MESSAGES.quoteFailed;
      else if (!logisticAvailable) fieldErrors.shipping = MERCADO_ENVIOS_MESSAGES.logisticUnavailable;

      if (shipping?.freeShippingPolicy === "mandatory" && !request.freeShipping) {
        checks.push({
          id: "free_shipping",
          label: "Política de frete grátis",
          status: "error",
          detail: MERCADO_ENVIOS_MESSAGES.mandatoryFreeShipping,
        });
        fieldErrors.shipping = MERCADO_ENVIOS_MESSAGES.mandatoryFreeShipping;
      } else {
        checks.push({
          id: "free_shipping",
          label: "Política de frete grátis",
          status: "ok",
          detail: freeShippingPolicyLabel(shipping?.freeShippingPolicy),
        });
      }
    }

    const selectedQuote = requiresMercadoEnvios
      ? request.freeShipping
        ? shipping?.quotes.freeShipping ?? null
        : shipping?.quotes.buyerPaysShipping ?? null
      : null;

    if (requiresMercadoEnvios) {
      checks.push({
        id: "shipping_quote",
        label: "Frete calculado",
        status: selectedQuote?.available ? "ok" : shipping?.available ? "warning" : "skipped",
        detail: selectedQuote?.available
          ? null
          : selectedQuote?.error ?? (shipping?.available ? MERCADO_ENVIOS_MESSAGES.quoteFailed : null),
      });
    }

    const listingPrice = await fetchListingPrice(account.access_token, account.site_id || "MLB", {
      categoryId: request.categoryId,
      price: request.price,
      listingTypeId: request.listingTypeId,
      shippingMode: requiresMercadoEnvios ? "me2" : request.shippingMode,
      logisticType: requiresMercadoEnvios ? request.logisticType : "",
    });

    const costs = computeMercadoLivreListingCosts({
      price: request.price,
      saleFeeAmount: listingPrice?.sale_fee_amount ?? null,
      fixedFee: listingPrice?.sale_fee_details?.fixed_fee ?? null,
      percentageFee: listingPrice?.sale_fee_details?.percentage_fee ?? null,
      financingFee: listingPrice?.sale_fee_details?.financing_add_on_fee ?? null,
      listingFeeAmount: listingPrice?.listing_fee_amount ?? null,
      sellerShippingCost: selectedQuote?.sellerShippingCost ?? null,
    });

    checks.push({
      id: "listing_costs",
      label: "Custos de venda calculados",
      status: costs.marketplaceCost != null ? "ok" : "warning",
      detail: costs.marketplaceCost != null ? null : "O Mercado Livre não retornou o custo por vender para esta combinação.",
    });

    const validation = await runMercadoLivreItemValidation(account.access_token, payload, {
      shippingMode: request.shippingMode,
    });
    checks.push({
      id: "items_validate",
      label: "Publicação validada pelo Mercado Livre",
      status: validation.valid ? "ok" : "error",
      detail: validation.valid ? null : validation.errors.join(" ") || MERCADO_ENVIOS_MESSAGES.listingInvalid,
    });
    Object.assign(fieldErrors, validation.fieldErrors);

    const hasError = checks.some((check) => check.status === "error");
    const warnings = [
      ...validation.warnings,
      ...(shipping?.warnings ?? []),
      ...checks.filter((check) => check.status === "warning" && check.detail).map((check) => check.detail as string),
    ];

    await logMercadoLivreListingPayload({
      empresaId: account.empresa_id,
      produtoId: request.produtoId,
      mlUserId: account.ml_user_id,
      operacao: "VALIDACAO",
      status: hasError ? "ERRO" : warnings.length ? "AVISO" : "SUCESSO",
      categoryId: request.categoryId,
      listingTypeId: request.listingTypeId,
      shippingMode: request.shippingMode,
      logisticType: request.logisticType,
      freeShipping: request.freeShipping,
      httpStatus: validation.status,
      itemPayload: payload,
      shippingModesRequest: shipping?.shippingModesRequest ?? null,
      shippingModesResponse: shipping?.shippingModesResponse ?? null,
      response: validation.validation,
      warnings,
      error: hasError ? checks.filter((check) => check.status === "error").map((check) => check.detail ?? check.label).join(" ") : null,
    });

    console.info("mercado-livre listing validation", {
      empresa_id: account.empresa_id,
      ml_user_id: account.ml_user_id,
      category_id: request.categoryId,
      listing_type_id: request.listingTypeId,
      shipping_mode: request.shippingMode,
      logistic_type: request.logisticType,
      free_shipping: request.freeShipping,
      validate_status: validation.status,
      state: hasError ? "invalid" : "valid",
    });

    return NextResponse.json({
      data: {
        state: hasError ? "invalid" : "valid",
        checks,
        fieldErrors,
        errors: checks.filter((check) => check.status === "error").map((check) => check.detail ?? check.label),
        warnings,
        shipping: shipping
          ? {
              available: shipping.available,
              mode: shipping.mode,
              logisticType: shipping.logisticType,
              logistics: shipping.logistics.map((option) => ({
                type: option.type,
                default: option.default,
                label: mercadoEnviosLogisticLabel(option.type),
              })),
              freeShippingPolicy: shipping.freeShippingPolicy,
              quotes: shipping.quotes,
              physicalWeight: shipping.physicalWeight,
              billableWeight: shipping.billableWeight,
              message: shipping.message,
            }
          : null,
        costs: {
          ...costs,
          currencyId: listingPrice?.currency_id ?? "BRL",
        },
      },
    });
  } catch (e: any) {
    console.error("POST /api/integracoes/mercadolivre/items/validate", e);
    return NextResponse.json(
      { error: formatMercadoLivreError(e) || MERCADO_ENVIOS_MESSAGES.listingInvalid },
      { status: Number(e?.status) || errorStatus(e) },
    );
  }
}

/**
 * `billable_weight` é documentado como obrigatório apenas na Argentina e a lógica
 * de cálculo do Brasil informa que o peso faturável não se aplica, então não é enviado.
 */
async function fetchListingPrice(
  accessToken: string,
  siteId: string,
  params: { categoryId: string; price: number; listingTypeId: string; shippingMode: string; logisticType: string },
) {
  const query = new URLSearchParams({
    price: String(params.price),
    currency_id: "BRL",
    category_id: params.categoryId,
    listing_type_id: params.listingTypeId,
  });
  if (params.shippingMode) query.set("shipping_mode", params.shippingMode);
  if (params.logisticType) query.set("logistic_type", params.logisticType);

  const raw = await mercadoLivreApiGet<ListingPrice | ListingPrice[]>(
    accessToken,
    `/sites/${encodeURIComponent(siteId)}/listing_prices?${query.toString()}`,
  ).catch(() => null);
  if (!raw) return null;
  const flat = Array.isArray(raw) ? (raw.flat() as ListingPrice[]) : [raw];
  return flat.find((entry: any) => entry?.listing_type_id === params.listingTypeId) ?? flat[0] ?? null;
}

function freeShippingPolicyLabel(policy: string | undefined) {
  if (policy === "mandatory") return "Frete grátis obrigatório.";
  if (policy === "optional") return "Frete grátis opcional.";
  if (policy === "unavailable") return "Frete grátis indisponível.";
  return "O Mercado Livre não informou a política de frete grátis para este anúncio.";
}
