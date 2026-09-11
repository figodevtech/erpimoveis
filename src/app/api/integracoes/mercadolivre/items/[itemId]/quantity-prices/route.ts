import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess, requireVendasEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { getValidMercadoLivreAccount } from "@/lib/integrations/mercadolivre-account";
import { registerMercadoLivreOutboundTouch } from "@/lib/integrations/mercadolivre-outbound-touch";
import { mercadoLivreApiGet, mercadoLivreApiPost } from "@/lib/integrations/mercadolivre";
import {
  buildMercadoLivreQuantityPricePayload,
  validateMercadoLivreQuantityTiers,
} from "@/lib/integrations/mercadolivre-quantity-pricing";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ itemId: string }> };

export async function GET(request: NextRequest, context: Params) {
  try {
    await requireVendasAccess();
    const { itemId } = await resolveItem(request, context);
    const empresaId = await requireEmpresaId();
    const account = await getValidMercadoLivreAccount(empresaId);
    const [user, item, prices, { data: preferences }] = await Promise.all([
      mercadoLivreApiGet<any>(account.access_token, `/users/${account.ml_user_id}`),
      mercadoLivreApiGet<any>(account.access_token, `/items/${encodeURIComponent(itemId)}`),
      getPrices(account.access_token, itemId),
      supabaseAdmin
        .from("mercadolivre_account")
        .select("quantity_pricing_default_enabled, quantity_pricing_default_tiers")
        .eq("empresa_id", empresaId)
        .maybeSingle(),
    ]);
    const eligible = userTags(user).includes("business");
    const quantities = parseQuantities(request.nextUrl.searchParams.get("quantities"));
    const recommendations = eligible
      ? await getRecommendations(account.access_token, itemId, Number(item?.price ?? 0), item?.currency_id || "BRL", quantities)
      : null;

    return NextResponse.json({
      eligible,
      reason: eligible ? null : "O Mercado Livre ainda não habilitou esta conta para vendas B2B (tag business).",
      itemId,
      basePrice: Number(item?.price ?? 0),
      currency: item?.currency_id || "BRL",
      version: Number(prices?.version ?? 0) || null,
      tiers: currentTiers(prices),
      recommendations: normalizeRecommendations(recommendations),
      defaults: {
        enabled: Boolean(preferences?.quantity_pricing_default_enabled),
        tiers: validateMercadoLivreQuantityTiers(preferences?.quantity_pricing_default_tiers ?? []),
      },
    });
  } catch (error: any) {
    console.error("GET /api/integracoes/mercadolivre/items/[itemId]/quantity-prices", error);
    return NextResponse.json({ error: friendlyError(error, "Falha ao consultar preços por quantidade.") }, { status: Number(error?.status) || errorStatus(error) });
  }
}

export async function POST(request: NextRequest, context: Params) {
  try {
    await requireVendasEdit();
    const { itemId, body } = await resolveItem(request, context, true);
    const empresaId = await requireEmpresaId();
    const account = await getValidMercadoLivreAccount(empresaId);
    const [user, item, prices] = await Promise.all([
      mercadoLivreApiGet<any>(account.access_token, `/users/${account.ml_user_id}`),
      mercadoLivreApiGet<any>(account.access_token, `/items/${encodeURIComponent(itemId)}`),
      getPrices(account.access_token, itemId),
    ]);
    if (!userTags(user).includes("business")) {
      const error = new Error("Esta conta ainda não foi habilitada pelo Mercado Livre para preços por quantidade B2B.");
      (error as any).status = 422;
      throw error;
    }

    const tiers = validateMercadoLivreQuantityTiers(body?.tiers);
    if (tiers.length) {
      const recommendationResponse = await getRecommendations(
        account.access_token,
        itemId,
        Number(item?.price ?? 0),
        item?.currency_id || "BRL",
        tiers.map((tier) => tier.quantity),
      );
      const recommendations = normalizeRecommendations(recommendationResponse);
      for (const tier of tiers) {
        const recommended = recommendations.find((entry: { quantity: number; percentage: number; incoherent: boolean }) => entry.quantity === tier.quantity);
        if (recommended?.incoherent) {
          const error = new Error(`A quantidade ${tier.quantity} foi considerada incoerente pelo Mercado Livre.`);
          (error as any).status = 422;
          throw error;
        }
        if (recommended && tier.percentage + 0.0001 < recommended.percentage) {
          const error = new Error(`Para ${tier.quantity} unidade(s), use desconto mínimo de ${recommended.percentage.toFixed(2)}% conforme a recomendação do Mercado Livre.`);
          (error as any).status = 422;
          throw error;
        }
      }
    }

    const version = Number(prices?.version);
    if (!Number.isFinite(version) || version <= 0) throw new Error("O Mercado Livre não retornou a versão atual dos preços do anúncio.");
    const result = await mercadoLivreApiPost<any>(
      account.access_token,
      `/items/${encodeURIComponent(itemId)}/prices/price-per-quantity`,
      buildMercadoLivreQuantityPricePayload(tiers),
      { "X-Version": String(version) },
    );
    await registerMercadoLivreOutboundTouch({
      empresaId: account.empresa_id,
      itemId,
      kinds: "PRECO_QUANTIDADE",
      origin: "POST /items/[itemId]/quantity-prices",
    });
    return NextResponse.json({ success: true, tiers: currentTiers(result), raw: result });
  } catch (error: any) {
    console.error("POST /api/integracoes/mercadolivre/items/[itemId]/quantity-prices", error);
    return NextResponse.json({ error: friendlyError(error, "Falha ao salvar preços por quantidade.") }, { status: Number(error?.status) || errorStatus(error) });
  }
}

async function resolveItem(request: NextRequest, context: Params, readBody = false) {
  const empresaId = await requireEmpresaId();
  const { itemId: rawItemId } = await context.params;
  const itemId = String(rawItemId ?? "").trim().toUpperCase();
  if (!/^ML[A-Z]\d+$/.test(itemId)) {
    const error = new Error("Código do anúncio inválido.");
    (error as any).status = 400;
    throw error;
  }
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_product_link")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("ml_item_id", itemId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const error = new Error("Este anúncio não está vinculado à empresa atual.");
    (error as any).status = 404;
    throw error;
  }
  return { itemId, body: readBody ? await request.json().catch(() => ({})) : null };
}

function getPrices(accessToken: string, itemId: string) {
  return mercadoLivreApiGet<any>(
    accessToken,
    `/items/${encodeURIComponent(itemId)}/prices?display_version=true`,
    { "show-all-prices": "true" },
  );
}

function getRecommendations(accessToken: string, itemId: string, price: number, currency: string, quantities: number[]) {
  return mercadoLivreApiPost<any>(accessToken, "/prices-per-quantity/v1/recommendations", {
    item_id: itemId,
    range_item_quantities: quantities,
    price: { standard_amount: price, currency },
  });
}

function userTags(user: any) {
  return (Array.isArray(user?.tags) ? user.tags : []).map((tag: unknown) => String(tag).toLowerCase());
}

function parseQuantities(value: string | null) {
  const parsed = String(value ?? "2,5,10")
    .split(",")
    .map((entry) => Math.trunc(Number(entry)))
    .filter((entry) => Number.isInteger(entry) && entry >= 1 && entry <= 100);
  return Array.from(new Set(parsed)).sort((a, b) => a - b).slice(0, 5);
}

function normalizeRecommendations(value: any) {
  return (Array.isArray(value?.recommendations) ? value.recommendations : []).map((entry: any) => ({
    quantity: Number(entry?.quantity ?? 0),
    percentage: Number(entry?.discount?.percentage ?? 0),
    unitPrice: Number(entry?.amount ?? 0),
    incoherent: Boolean(entry?.is_incoherent_quantity),
  }));
}

function currentTiers(value: any) {
  const candidates = [
    ...(Array.isArray(value?.price_per_quantity) ? value.price_per_quantity : []),
    ...(Array.isArray(value?.prices) ? value.prices : []),
  ];
  return candidates
    .filter((entry: any) => entry?.type === "discount_percentage" && Array.isArray(entry?.conditions?.context_restrictions) && entry.conditions.context_restrictions.includes("user_type_business"))
    .map((entry: any) => ({
      id: entry?.id ?? null,
      quantity: Number(entry?.conditions?.min_purchase_unit ?? 0),
      percentage: Number(entry?.percentage ?? 0),
    }))
    .filter((entry: any) => entry.quantity > 0 && entry.percentage > 0)
    .sort((a: any, b: any) => a.quantity - b.quantity);
}

function friendlyError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const responseMessage = message.match(/\{[\s\S]*\}$/)?.[0];
  if (responseMessage) {
    try {
      const parsed = JSON.parse(responseMessage);
      return parsed?.message || parsed?.error || fallback;
    } catch {
      // Mantém a mensagem original quando a resposta externa não for JSON válido.
    }
  }
  return message || fallback;
}
