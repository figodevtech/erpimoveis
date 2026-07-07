import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ML_API_BASE_URL = "https://api.mercadolibre.com";

type MercadoLivreAttribute = {
  id?: string;
  name?: string;
  value_type?: string;
  value_max_length?: number;
  tags?: {
    required?: boolean;
    catalog_required?: boolean;
    fixed?: boolean;
    hidden?: boolean;
    read_only?: boolean;
  };
  values?: Array<{ id?: string; name?: string }>;
  allowed_units?: Array<{ id?: string; name?: string }>;
  default_unit?: string;
  hint?: string;
  tooltip?: string;
  attribute_group_name?: string;
};

type CategoryDetail = {
  settings?: {
    item_conditions?: string[];
    shipping_options?: string[];
    simple_shipping?: string;
    shipping_profile?: string;
  };
};

export async function GET(req: NextRequest) {
  try {
    await requireVendasAccess();
    const categoryId = req.nextUrl.searchParams.get("categoryId")?.trim().toUpperCase();

    if (!categoryId) {
      return NextResponse.json({ error: "Informe a categoria." }, { status: 400 });
    }

    const [attributes, detail] = await Promise.all([
      mercadoLivrePublicGet<MercadoLivreAttribute[]>(`/categories/${encodeURIComponent(categoryId)}/attributes`),
      mercadoLivrePublicGet<CategoryDetail>(`/categories/${encodeURIComponent(categoryId)}`),
    ]);
    const data = (attributes ?? [])
      .filter((attribute) => attribute.id && attribute.name && !attribute.tags?.hidden && !attribute.tags?.read_only)
      .map((attribute) => ({
        id: attribute.id,
        name: attribute.name,
        valueType: attribute.value_type ?? "string",
        required: Boolean(attribute.tags?.required || attribute.tags?.catalog_required),
        fixed: Boolean(attribute.tags?.fixed),
        values: (attribute.values ?? []).map((value) => ({ id: value.id, name: value.name })).filter((value) => value.name),
        allowedUnits: (attribute.allowed_units ?? []).map((unit) => ({ id: unit.id, name: unit.name })).filter((unit) => unit.name),
        defaultUnit: attribute.default_unit ?? null,
        hint: attribute.hint || attribute.tooltip || null,
        groupName: attribute.attribute_group_name ?? null,
      }))
      .sort((a, b) => Number(b.required) - Number(a.required));

    return NextResponse.json({
      data,
      settings: {
        shippingOptions: detail.settings?.shipping_options ?? [],
        simpleShipping: detail.settings?.simple_shipping ?? null,
        shippingProfile: detail.settings?.shipping_profile ?? null,
        conditionOptions: detail.settings?.item_conditions ?? null,
      },
    });
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/category-attributes", e);
    return NextResponse.json({ error: e?.message || "Falha ao buscar atributos da categoria." }, { status: 500 });
  }
}

async function mercadoLivrePublicGet<T>(path: string) {
  const response = await fetch(`${ML_API_BASE_URL}${path}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "erpoficina-marketplace/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mercado Livre ${path} falhou (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}
