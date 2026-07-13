import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess, requireVendasEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  mercadoLivreApiGet,
  mercadoLivreApiPost,
  mercadoLivreApiPut,
} from "@/lib/integrations/mercadolivre";
import { getValidMercadoLivreAccount } from "@/lib/integrations/mercadolivre-account";
import { validateMercadoLivreShippingSelection } from "@/lib/integrations/mercadolivre-shipping-preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParamsCtx = { params: Promise<{ itemId: string }> };

export async function GET(_req: NextRequest, ctx: ParamsCtx) {
  try {
    await requireVendasAccess();
    const empresaId = await requireEmpresaId();
    const { itemId } = await ctx.params;
    const link = await getLink(itemId, empresaId);
    const account = await getValidMercadoLivreAccount(link.empresa_id);
    const accessToken = account.access_token;

    const [item, description] = await Promise.all([
      mercadoLivreApiGet<any>(accessToken, `/items/${encodeURIComponent(itemId)}`),
      mercadoLivreApiGet<any>(accessToken, `/items/${encodeURIComponent(itemId)}/description`).catch(() => null),
    ]);

    const normalized = normalizeItemForEdit(item, description);

    await supabaseAdmin
      .from("mercadolivre_product_link")
      .update({
        status: item?.status ?? null,
        title: item?.title ?? link.title,
        permalink: item?.permalink ?? link.permalink,
        raw_item: item ?? {},
        updated_at: new Date().toISOString(),
      })
      .eq("id", link.id);

    return NextResponse.json({ data: normalized });
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/items/[itemId]", e);
    return NextResponse.json({ error: e?.message || "Falha ao carregar anúncio Mercado Livre." }, { status: errorStatus(e) });
  }
}

export async function PATCH(req: NextRequest, ctx: ParamsCtx) {
  try {
    await requireVendasEdit();
    const empresaId = await requireEmpresaId();
    const { itemId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "").toLowerCase();

    const link = await getLink(itemId, empresaId);
    const account = await getValidMercadoLivreAccount(link.empresa_id);
    const accessToken = account.access_token;

    let payload: Record<string, unknown>;
    if (action === "pause") payload = { status: "paused" };
    else if (action === "activate") payload = { status: "active" };
    else if (action === "close") payload = { status: "closed" };
    else if (action === "update_listing") {
      const shippingMode = String(body?.shippingMode ?? "").trim();
      if (shippingMode === "me2") {
        const currentItem = await mercadoLivreApiGet<any>(accessToken, `/items/${encodeURIComponent(itemId)}`);
        const categoryId = String(currentItem?.category_id ?? "").trim();
        if (!categoryId) throw new Error("O anúncio não possui categoria para validar o Mercado Envios.");
        await validateMercadoLivreShippingSelection(account, categoryId, shippingMode, String(body?.logisticType ?? ""));
      }
      payload = buildListingUpdatePayload(body);
    }
    else if (action === "sync_stock_price") {
      const { data: product, error: productError } = await supabaseAdmin
        .from("produto")
        .select("id, precovenda, estoque")
        .eq("id", link.produto_id)
        .single();

      if (productError) throw productError;
      payload = {
        price: Number((product as any).precovenda ?? 0),
        available_quantity: Math.max(Number((product as any).estoque ?? 0), 0),
      };
    } else {
      return NextResponse.json({ error: "Acao invalida." }, { status: 400 });
    }

    const updatedItem = await mercadoLivreApiPut<any>(accessToken, `/items/${encodeURIComponent(itemId)}`, payload);

    const description = String(body?.description ?? "").trim();
    if (action === "update_listing" && description) {
      await mercadoLivreApiPut(accessToken, `/items/${encodeURIComponent(itemId)}/description`, {
        plain_text: description,
      }).catch(async () => {
        await mercadoLivreApiPost(accessToken, `/items/${encodeURIComponent(itemId)}/description`, {
          plain_text: description,
        });
      });
    }

    const item = await mercadoLivreApiGet<any>(accessToken, `/items/${encodeURIComponent(itemId)}`).catch(() => updatedItem);

    const { error: updateError } = await supabaseAdmin
      .from("mercadolivre_product_link")
      .update({
        status: item?.status ?? null,
        title: item?.title ?? link.title,
        permalink: item?.permalink ?? link.permalink,
        raw_item: item ?? {},
        updated_at: new Date().toISOString(),
      })
      .eq("id", link.id);

    if (updateError) throw updateError;
    return NextResponse.json({ data: item, status: item?.status ?? null });
  } catch (e: any) {
    console.error("PATCH /api/integracoes/mercadolivre/items/[itemId]", e);
    return NextResponse.json({ error: e?.message || "Falha ao atualizar anúncio Mercado Livre." }, { status: errorStatus(e) });
  }
}

function normalizeItemForEdit(item: any, description: any) {
  const saleTerms = Array.isArray(item?.sale_terms) ? item.sale_terms : [];
  const warrantyType = saleTerms.find((term: any) => term?.id === "WARRANTY_TYPE");
  const warrantyTime = saleTerms.find((term: any) => term?.id === "WARRANTY_TIME");
  const shipping = item?.shipping ?? {};
  const dimensions = parseDimensions(shipping?.dimensions);

  return {
    id: item?.id ?? "",
    title: item?.title ?? "",
    price: Number(item?.price ?? 0),
    availableQuantity: Number(item?.available_quantity ?? 0),
    status: item?.status ?? null,
    permalink: item?.permalink ?? null,
    categoryId: item?.category_id ?? null,
    listingTypeId: item?.listing_type_id ?? null,
    condition: item?.condition ?? null,
    description: description?.plain_text ?? description?.text ?? "",
    pictures: Array.isArray(item?.pictures)
      ? item.pictures.map((picture: any) => picture?.secure_url || picture?.url || picture?.source).filter(Boolean)
      : [],
    warranty: warrantyType?.value_name ?? warrantyType?.value_id ?? "",
    warrantyTime: warrantyTime?.value_name ?? "",
    shippingMode: shipping?.mode ?? "",
    logisticType: shipping?.logistic_type ?? "",
    freeShipping: Boolean(shipping?.free_shipping),
    localPickup: Boolean(shipping?.local_pick_up),
    widthCm: dimensions.widthCm,
    heightCm: dimensions.heightCm,
    lengthCm: dimensions.lengthCm,
    weightGrams: dimensions.weightGrams,
  };
}

function parseDimensions(value: unknown) {
  const empty = { lengthCm: "", widthCm: "", heightCm: "", weightGrams: "" };
  const text = String(value ?? "").trim();
  const match = text.match(/^([\d.]+)x([\d.]+)x([\d.]+),(\d+)$/);
  if (!match) return empty;

  return {
    lengthCm: match[1] ?? "",
    widthCm: match[2] ?? "",
    heightCm: match[3] ?? "",
    weightGrams: match[4] ?? "",
  };
}

function buildListingUpdatePayload(body: any) {
  const payload: Record<string, unknown> = {};
  const title = String(body?.title ?? "").trim();
  const price = Number(body?.price);
  const availableQuantity = Math.trunc(Number(body?.availableQuantity));
  const warranty = String(body?.warranty ?? "").trim();
  const warrantyTime = String(body?.warrantyTime ?? "").trim();
  const pictureUrl = String(body?.pictureUrl ?? "").trim();
  const shippingMode = String(body?.shippingMode ?? "").trim();
  const logisticType = String(body?.logisticType ?? "").trim();
  const freeShipping = Boolean(body?.freeShipping);
  const widthCm = Number(body?.widthCm);
  const heightCm = Number(body?.heightCm);
  const lengthCm = Number(body?.lengthCm);
  const weightGrams = Math.trunc(Number(body?.weightGrams));

  if (shippingMode && shippingMode !== "me2") {
    throw new Error("O ERP mantém anúncios apenas com Mercado Envios habilitado.");
  }
  if (shippingMode === "me2" && !logisticType) {
    throw new Error("Selecione a logística do Mercado Envios.");
  }
  if (
    shippingMode === "me2" &&
    (![widthCm, heightCm, lengthCm].every((value) => Number.isFinite(value) && value > 0) || !Number.isInteger(weightGrams) || weightGrams <= 0)
  ) {
    throw new Error("Informe dimensões e peso para calcular o Mercado Envios.");
  }

  if (title) payload.title = title;
  if (Number.isFinite(price) && price > 0) payload.price = price;
  if (Number.isInteger(availableQuantity) && availableQuantity >= 0) payload.available_quantity = availableQuantity;

  const pictures = parsePictureUrls(pictureUrl);
  if (pictures.length) payload.pictures = pictures;

  const saleTerms = [
    warranty ? { id: "WARRANTY_TYPE", value_name: warranty } : null,
    warranty && warranty !== "Sem garantia" && warrantyTime ? { id: "WARRANTY_TIME", value_name: warrantyTime } : null,
  ].filter(Boolean);
  if (saleTerms.length) payload.sale_terms = saleTerms;

  if (shippingMode) {
    const shipping: Record<string, unknown> = {
      mode: shippingMode,
      free_shipping: freeShipping,
      local_pick_up: false,
    };
    if (logisticType) shipping.logistic_type = logisticType;
    if ([widthCm, heightCm, lengthCm].every((value) => Number.isFinite(value) && value > 0) && Number.isInteger(weightGrams) && weightGrams > 0) {
      shipping.dimensions = `${lengthCm}x${widthCm}x${heightCm},${weightGrams}`;
    }
    payload.shipping = shipping;
  }

  const packageAttributes = buildPackageAttributes({
    shippingMode,
    widthCm,
    heightCm,
    lengthCm,
    weightGrams,
  });
  if (packageAttributes.length) payload.attributes = packageAttributes;

  if (Object.keys(payload).length === 0) {
    throw new Error("Informe ao menos um campo para atualizar.");
  }

  return payload;
}

function buildPackageAttributes(params: {
  shippingMode: string;
  widthCm: number;
  heightCm: number;
  lengthCm: number;
  weightGrams: number;
}) {
  if (params.shippingMode !== "me2") return [];
  if (![params.widthCm, params.heightCm, params.lengthCm].every((value) => Number.isFinite(value) && value > 0)) return [];
  if (!Number.isInteger(params.weightGrams) || params.weightGrams <= 0) return [];

  return [
    { id: "SELLER_PACKAGE_LENGTH", value_struct: { number: params.lengthCm, unit: "cm" } },
    { id: "SELLER_PACKAGE_WIDTH", value_struct: { number: params.widthCm, unit: "cm" } },
    { id: "SELLER_PACKAGE_HEIGHT", value_struct: { number: params.heightCm, unit: "cm" } },
    { id: "SELLER_PACKAGE_WEIGHT", value_struct: { number: params.weightGrams, unit: "g" } },
  ];
}

function parsePictureUrls(value: string) {
  return value
    .split(/\r?\n/)
    .map((source) => source.trim())
    .filter((source) => {
      try {
        const url = new URL(source);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch {
        return false;
      }
    })
    .map((source) => ({ source }));
}

async function getLink(itemId: string, empresaId: number) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_product_link")
    .select("id, empresa_id, produto_id, ml_item_id, title, permalink")
    .eq("empresa_id", empresaId)
    .eq("ml_item_id", itemId.toUpperCase())
    .single();

  if (error) throw error;
  return data as { id: number; empresa_id: number; produto_id: number; ml_item_id: string; title?: string | null; permalink?: string | null };
}
