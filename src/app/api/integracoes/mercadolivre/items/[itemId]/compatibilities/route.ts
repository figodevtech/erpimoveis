import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess, requireVendasEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { getValidMercadoLivreAccount } from "@/lib/integrations/mercadolivre-account";
import { registerMercadoLivreOutboundTouch } from "@/lib/integrations/mercadolivre-outbound-touch";
import {
  mercadoLivreApiDelete,
  mercadoLivreApiGet,
  mercadoLivreApiPost,
  mercadoLivreApiPut,
} from "@/lib/integrations/mercadolivre";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ itemId: string }> };
type KnownAttribute = { id: string; value_id: string; value_name?: string };

const VEHICLE_DOMAIN = "MLB-CARS_AND_VANS";
const ALLOWED_ATTRIBUTES = new Set(["BRAND", "MODEL", "VEHICLE_YEAR", "SHORT_VERSION", "ENGINE"]);

export async function GET(request: NextRequest, context: Params) {
  try {
    await requireVendasAccess();
    const { itemId, account } = await resolveItem(request, context);
    const item = await mercadoLivreApiGet<any>(account.access_token, `/items/${encodeURIComponent(itemId)}`);
    const target = compatibilityTarget(itemId, item);
    const raw = await mercadoLivreApiGet<any>(account.access_token, `${target.path}?${target.query}`)
      .catch((error) => ({ products: [], _error: friendlyError(error, "Esta categoria não disponibilizou compatibilidades.") }));

    return NextResponse.json({
      itemId,
      title: String(item?.title ?? ""),
      categoryId: String(item?.category_id ?? ""),
      itemDomainId: String(item?.domain_id ?? ""),
      vehicleDomainId: VEHICLE_DOMAIN,
      userProductId: item?.user_product_id ? String(item.user_product_id) : null,
      required: itemTags(item).includes("incomplete_compatibilities"),
      pendingSuggestions: itemTags(item).includes("pending_compatibilities"),
      available: !raw?._error,
      unavailableReason: raw?._error ?? null,
      products: normalizeCompatibilities(raw?.products),
    });
  } catch (error: any) {
    console.error("GET /api/integracoes/mercadolivre/items/[itemId]/compatibilities", error);
    return NextResponse.json(
      { error: friendlyError(error, "Falha ao consultar compatibilidades do anúncio.") },
      { status: Number(error?.status) || errorStatus(error) },
    );
  }
}

export async function POST(request: NextRequest, context: Params) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    if (action === "options") await requireVendasAccess();
    else await requireVendasEdit();

    const { itemId, account } = await resolveItem(request, context);
    if (action === "options") {
      const attributeId = normalizeAttributeId(body?.attributeId);
      const knownAttributes = normalizeKnownAttributes(body?.knownAttributes);
      const options = await mercadoLivreApiPost<any[]>(
        account.access_token,
        `/catalog_domains/${VEHICLE_DOMAIN}/attributes/${attributeId}/top_values?limit=1000`,
        knownAttributes.length ? { known_attributes: knownAttributes } : {},
      );
      return NextResponse.json({
        options: (Array.isArray(options) ? options : []).map((option) => ({
          id: String(option?.id ?? ""),
          name: String(option?.name ?? ""),
          metric: Number(option?.metric ?? 0),
        })).filter((option) => option.id && option.name),
      });
    }

    if (action !== "add") return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    const attributes = normalizeKnownAttributes(body?.attributes);
    if (!attributes.some((attribute) => attribute.id === "BRAND") || !attributes.some((attribute) => attribute.id === "MODEL")) {
      return NextResponse.json({ error: "Selecione ao menos a marca e o modelo do veículo." }, { status: 422 });
    }
    const note = String(body?.note ?? "").trim().slice(0, 500);
    const item = await mercadoLivreApiGet<any>(account.access_token, `/items/${encodeURIComponent(itemId)}`);
    const family = {
      domain_id: VEHICLE_DOMAIN,
      creation_source: "DEFAULT",
      attributes,
      ...(note ? { note } : {}),
      restrictions: [],
    };
    const result = item?.user_product_id
      ? await mercadoLivreApiPost<any>(account.access_token, `/user-products/${encodeURIComponent(String(item.user_product_id))}/compatibilities`, {
          domain_id: VEHICLE_DOMAIN,
          category_id: String(item?.category_id ?? ""),
          products_families: [family],
        })
      : await mercadoLivreApiPost<any>(account.access_token, `/items/${encodeURIComponent(itemId)}/compatibilities`, {
          products_families: [family],
        });
    await registerMercadoLivreOutboundTouch({
      empresaId: account.empresa_id,
      itemId,
      kinds: "COMPATIBILIDADE",
      origin: "POST /items/[itemId]/compatibilities",
    });
    return NextResponse.json({ success: true, created: Number(result?.created_compatibilities_count ?? 0), raw: result });
  } catch (error: any) {
    console.error("POST /api/integracoes/mercadolivre/items/[itemId]/compatibilities", error);
    return NextResponse.json(
      { error: friendlyError(error, "Falha ao salvar compatibilidades do anúncio.") },
      { status: Number(error?.status) || errorStatus(error) },
    );
  }
}

export async function DELETE(request: NextRequest, context: Params) {
  try {
    await requireVendasEdit();
    const body = await request.json().catch(() => ({}));
    const catalogProductId = String(body?.catalogProductId ?? "").trim().toUpperCase();
    if (!/^MLB\d+$/.test(catalogProductId)) {
      return NextResponse.json({ error: "Compatibilidade inválida ou gerenciada pelo catálogo." }, { status: 422 });
    }
    const { itemId, account } = await resolveItem(request, context);
    const item = await mercadoLivreApiGet<any>(account.access_token, `/items/${encodeURIComponent(itemId)}`);
    const target = compatibilityTarget(itemId, item);
    const current = await mercadoLivreApiGet<any>(account.access_token, `${target.path}?${target.query}`);
    const removable = normalizeCompatibilities(current?.products).some(
      (entry) => entry.source === "SELLER" && entry.catalogProductId === catalogProductId,
    );
    if (!removable) {
      return NextResponse.json(
        { error: "Esta compatibilidade não foi criada pelo vendedor ou já não está disponível para exclusão." },
        { status: 422 },
      );
    }
    const result = item?.user_product_id
      ? await mercadoLivreApiPut<any>(account.access_token, `/user-products/${encodeURIComponent(String(item.user_product_id))}/compatibilities`, {
          domain_id: VEHICLE_DOMAIN,
          category_id: String(item?.category_id ?? ""),
          delete: { products: [{ id: catalogProductId }] },
        })
      : await mercadoLivreApiDelete<any>(account.access_token, `/items/${encodeURIComponent(itemId)}/compatibilities`, {
          products: [{ id: catalogProductId }],
        });
    await registerMercadoLivreOutboundTouch({
      empresaId: account.empresa_id,
      itemId,
      kinds: "COMPATIBILIDADE",
      origin: "DELETE /items/[itemId]/compatibilities",
    });
    return NextResponse.json({ success: true, raw: result });
  } catch (error: any) {
    console.error("DELETE /api/integracoes/mercadolivre/items/[itemId]/compatibilities", error);
    return NextResponse.json(
      { error: friendlyError(error, "Falha ao remover compatibilidade do anúncio.") },
      { status: Number(error?.status) || errorStatus(error) },
    );
  }
}

async function resolveItem(_request: NextRequest, context: Params) {
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
  return { itemId, account: await getValidMercadoLivreAccount(empresaId) };
}

function compatibilityTarget(itemId: string, item: any) {
  if (item?.user_product_id) {
    return {
      path: `/user-products/${encodeURIComponent(String(item.user_product_id))}/compatibilities`,
      query: new URLSearchParams({ main_domain_id: VEHICLE_DOMAIN, extended: "true" }).toString(),
    };
  }
  return {
    path: `/items/${encodeURIComponent(itemId)}/compatibilities`,
    query: new URLSearchParams({ extended: "true" }).toString(),
  };
}

function normalizeAttributeId(value: unknown) {
  const id = String(value ?? "").trim().toUpperCase();
  if (!ALLOWED_ATTRIBUTES.has(id)) {
    const error = new Error("Atributo de veículo inválido.");
    (error as any).status = 400;
    throw error;
  }
  return id;
}

function normalizeKnownAttributes(value: unknown): KnownAttribute[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry: any) => {
    const id = String(entry?.id ?? "").trim().toUpperCase();
    const valueId = String(entry?.value_id ?? entry?.valueId ?? "").trim();
    const valueName = String(entry?.value_name ?? entry?.valueName ?? "").trim();
    if (!ALLOWED_ATTRIBUTES.has(id) || !valueId || seen.has(id)) return [];
    seen.add(id);
    return [{ id, value_id: valueId, ...(valueName ? { value_name: valueName } : {}) }];
  });
}

function normalizeCompatibilities(value: unknown) {
  return (Array.isArray(value) ? value : []).map((entry: any) => ({
    id: entry?.id ? String(entry.id) : null,
    catalogProductId: entry?.catalog_product_id ? String(entry.catalog_product_id) : null,
    name: String(entry?.catalog_product_name ?? "Compatibilidade do catálogo"),
    domainId: entry?.domain_id ? String(entry.domain_id) : null,
    source: String(entry?.source ?? "SELLER").toUpperCase(),
    total: Number(entry?.total ?? 1),
    note: entry?.note ? String(entry.note) : null,
    restrictions: Array.isArray(entry?.restrictions) ? entry.restrictions : [],
    reputationLevel: entry?.reputation?.level ? String(entry.reputation.level) : null,
  }));
}

function itemTags(item: any) {
  return (Array.isArray(item?.tags) ? item.tags : []).map((tag: unknown) => String(tag).toLowerCase());
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
