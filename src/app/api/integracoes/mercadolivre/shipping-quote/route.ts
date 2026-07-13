import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { getValidMercadoLivreAccount } from "@/lib/integrations/mercadolivre-account";
import { mercadoLivreApiGet } from "@/lib/integrations/mercadolivre";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await requireVendasAccess();
    const empresaId = await requireEmpresaId();
    const body = await req.json().catch(() => ({}));
    const itemPrice = Number(body?.itemPrice);
    const listingTypeId = String(body?.listingTypeId ?? "").trim();
    const condition = String(body?.condition ?? "new").trim();
    const logisticType = String(body?.logisticType ?? "").trim();
    const length = Number(body?.lengthCm);
    const width = Number(body?.widthCm);
    const height = Number(body?.heightCm);
    const weight = Math.trunc(Number(body?.weightGrams));
    const freeShipping = Boolean(body?.freeShipping);

    if (!Number.isFinite(itemPrice) || itemPrice <= 0) return badRequest("Informe um preço válido para simular o frete.");
    if (!listingTypeId) return badRequest("Informe o tipo de anúncio.");
    if (!logisticType) return badRequest("Selecione uma logística do Mercado Envios.");
    if (![length, width, height].every((value) => Number.isFinite(value) && value > 0) || !Number.isInteger(weight) || weight <= 0) {
      return badRequest("Informe comprimento, largura, altura e peso válidos.");
    }

    const account = await getValidMercadoLivreAccount(empresaId);
    const params = new URLSearchParams({
      dimensions: `${height}x${width}x${length},${weight}`,
      verbose: "true",
      item_price: String(itemPrice),
      listing_type_id: listingTypeId,
      mode: "me2",
      condition,
      logistic_type: logisticType,
      free_shipping: String(freeShipping),
    });
    const quote = await mercadoLivreApiGet<any>(
      account.access_token,
      `/users/${account.ml_user_id}/shipping_options/free?${params.toString()}`,
    );

    return NextResponse.json({
      data: {
        currencyId: quote?.currency_id ?? "BRL",
        listCost: numberOrNull(quote?.list_cost ?? quote?.coverage?.list_cost),
        sellerCost: numberOrNull(quote?.cost ?? quote?.coverage?.cost ?? quote?.seller?.cost),
        billableWeight: numberOrNull(quote?.billable_weight ?? quote?.coverage?.billable_weight),
        raw: quote ?? {},
      },
    });
  } catch (error: any) {
    console.error("POST /api/integracoes/mercadolivre/shipping-quote", error);
    return NextResponse.json(
      { error: friendlyQuoteError(error) },
      { status: errorStatus(error) },
    );
  }
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function friendlyQuoteError(error: any) {
  const message = String(error?.message ?? "Falha ao simular custo do Mercado Envios.");
  if (message.includes("PA_UNAUTHORIZED") || message.toLowerCase().includes("forbidden")) {
    return "A conta conectada não tem permissão para simular Mercado Envios.";
  }
  if (message.includes("shipping_options/free")) {
    const jsonStart = message.indexOf("{");
    if (jsonStart >= 0) {
      try {
        const parsed = JSON.parse(message.slice(jsonStart));
        return parsed?.message || parsed?.error || "O Mercado Livre não conseguiu calcular o frete com os dados informados.";
      } catch {
        return "O Mercado Livre não conseguiu calcular o frete com os dados informados.";
      }
    }
  }
  return message;
}
