import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { getValidMercadoLivreAccount } from "@/lib/integrations/mercadolivre-account";
import {
  MERCADO_ENVIOS_MESSAGES,
  mercadoEnviosLogisticLabel,
} from "@/lib/integrations/mercadolivre-mercado-envios";
import { friendlyQuoteError, resolveMercadoEnviosForListing } from "@/lib/integrations/mercadolivre-shipping-preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Consulta o Mercado Envios para um anúncio específico e devolve a estrutura
 * normalizada que a tela consome: disponibilidade, logísticas, política de frete
 * grátis e as duas cotações possíveis.
 */
export async function POST(req: NextRequest) {
  try {
    await requireVendasAccess();
    const empresaId = await requireEmpresaId();
    const body = await req.json().catch(() => ({}));

    const categoryId = String(body?.categoryId ?? "").trim().toUpperCase();
    const price = Number(body?.price);
    const listingTypeId = String(body?.listingTypeId ?? "").trim();
    const condition = String(body?.condition ?? "new").trim().toLowerCase();
    const title = String(body?.title ?? "").trim();
    const preferredLogisticType = String(body?.logisticType ?? "").trim();
    const lengthCm = Number(body?.lengthCm);
    const widthCm = Number(body?.widthCm);
    const heightCm = Number(body?.heightCm);
    const weightGrams = Math.trunc(Number(body?.weightGrams));
    const localPickup = Boolean(body?.localPickup);
    const saleTerms = Array.isArray(body?.saleTerms) ? body.saleTerms : [];
    const attributes = Array.isArray(body?.attributes) ? body.attributes : [];

    if (!categoryId) return NextResponse.json({ error: "Informe a categoria Mercado Livre." }, { status: 400 });
    if (!Number.isFinite(price) || price <= 0) return NextResponse.json({ error: "Informe um preço válido." }, { status: 400 });
    if (!listingTypeId) return NextResponse.json({ error: "Informe o tipo de anúncio." }, { status: 400 });

    const account = await getValidMercadoLivreAccount(empresaId);
    const result = await resolveMercadoEnviosForListing(account, {
      context: {
        title: title || "Anúncio",
        categoryId,
        price,
        currencyId: "BRL",
        listingTypeId,
        condition: condition || "new",
        localPickup,
        dimensions: null,
        saleTerms,
        attributes,
      },
      lengthCm,
      widthCm,
      heightCm,
      weightGrams,
      preferredLogisticType,
    });

    console.info("mercado-envios resolved", {
      empresa_id: account.empresa_id,
      ml_user_id: account.ml_user_id,
      category_id: categoryId,
      listing_type_id: listingTypeId,
      shipping_mode: result.mode,
      logistic_type: result.logisticType,
      free_shipping_policy: result.freeShippingPolicy,
      available: result.available,
    });

    return NextResponse.json({
      data: {
        available: result.available,
        mode: result.mode,
        logisticType: result.logisticType,
        logistics: result.logistics.map((option) => ({
          type: option.type,
          default: option.default,
          label: mercadoEnviosLogisticLabel(option.type),
        })),
        availableModes: result.availableModes,
        freeShippingPolicy: result.freeShippingPolicy,
        quotes: result.quotes,
        physicalWeight: result.physicalWeight,
        billableWeight: result.billableWeight,
        origin: result.origin,
        warnings: result.warnings,
        message: result.message,
        preferences: {
          categoryModes: result.preferences.categoryModes,
          userModes: result.preferences.userModes,
          me2Restricted: result.preferences.me2Restricted,
          me2Restrictions: result.preferences.me2Restrictions,
          userShippingOption: result.preferences.userShippingOption,
          defaultDimensions: result.preferences.defaultDimensions,
        },
      },
    });
  } catch (error: any) {
    console.error("POST /api/integracoes/mercadolivre/mercado-envios", error);
    return NextResponse.json(
      { error: friendlyQuoteError(error) || MERCADO_ENVIOS_MESSAGES.quoteFailed },
      { status: Number(error?.status) || errorStatus(error) },
    );
  }
}
