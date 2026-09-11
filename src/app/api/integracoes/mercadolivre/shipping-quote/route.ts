import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { getValidMercadoLivreAccount } from "@/lib/integrations/mercadolivre-account";
import { getMercadoLivreShippingAddress } from "@/lib/integrations/mercadolivre-address";
import { buildMercadoLivreShippingDimensions } from "@/lib/integrations/mercadolivre-mercado-envios";
import { friendlyQuoteError, quoteMercadoEnvios } from "@/lib/integrations/mercadolivre-shipping-preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const origin = { current: null as Awaited<ReturnType<typeof getMercadoLivreShippingAddress>> | null };
  try {
    await requireVendasAccess();
    const empresaId = await requireEmpresaId();
    const body = await req.json().catch(() => ({}));
    const itemPrice = Number(body?.itemPrice);
    const listingTypeId = String(body?.listingTypeId ?? "").trim();
    const condition = String(body?.condition ?? "new").trim();
    const logisticType = String(body?.logisticType ?? "").trim();
    const categoryId = String(body?.categoryId ?? "").trim().toUpperCase();
    const lengthCm = Number(body?.lengthCm);
    const widthCm = Number(body?.widthCm);
    const heightCm = Number(body?.heightCm);
    const weightGrams = Math.trunc(Number(body?.weightGrams));
    const freeShipping = Boolean(body?.freeShipping);

    if (!Number.isFinite(itemPrice) || itemPrice <= 0) return badRequest("Informe um preço válido para simular o frete.");
    if (!listingTypeId) return badRequest("Informe o tipo de anúncio.");
    if (!logisticType) return badRequest("Selecione uma logística do Mercado Envios.");

    const dimensions = buildMercadoLivreShippingDimensions({ lengthCm, widthCm, heightCm, weightGrams });
    if (!dimensions) return badRequest("Informe comprimento, largura, altura e peso válidos.");

    const account = await getValidMercadoLivreAccount(empresaId);
    origin.current = await getMercadoLivreShippingAddress(account.access_token, account.ml_user_id).catch(() => null);

    const quote = await quoteMercadoEnvios(account, {
      itemPrice,
      listingTypeId,
      condition,
      logisticType,
      freeShipping,
      dimensions,
      categoryId: categoryId || null,
      origin: origin.current,
      keepRaw: true,
    });

    return NextResponse.json({ data: quote });
  } catch (error: any) {
    console.error("POST /api/integracoes/mercadolivre/shipping-quote", error);
    return NextResponse.json(
      { error: friendlyQuoteError(error, origin.current) },
      { status: errorStatus(error) },
    );
  }
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}
