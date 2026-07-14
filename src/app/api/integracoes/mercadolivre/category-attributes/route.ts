import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { requireEmpresaId } from "@/lib/empresa-context";
import { getValidMercadoLivreAccount } from "@/lib/integrations/mercadolivre-account";
import { mercadoLivreApiGet } from "@/lib/integrations/mercadolivre";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    variation_attribute?: boolean;
    allow_variations?: boolean;
    parent_pk?: boolean;
    child_pk?: boolean;
  };
  values?: Array<{ id?: string; name?: string }>;
  allowed_units?: Array<{ id?: string; name?: string }>;
  default_unit?: string;
  hint?: string;
  tooltip?: string;
  attribute_group_name?: string;
  hierarchy?: string;
};

type CategoryDetail = {
  settings?: {
    item_conditions?: string[];
    shipping_options?: string[];
    simple_shipping?: string;
    shipping_profile?: string;
  };
};

type ShippingPreferences = {
  dimensions?: { height?: number; width?: number; length?: number; weight?: number } | null;
  modes?: string[];
  option?: string | null;
  restricted?: boolean;
  me2_restrictions?: string[] | string | null;
  logistics?: Array<{
    mode?: string;
    types?: Array<string | { type?: string }>;
  }>;
};

export async function GET(req: NextRequest) {
  try {
    await requireVendasAccess();
    const empresaId = await requireEmpresaId();
    const categoryId = req.nextUrl.searchParams.get("categoryId")?.trim().toUpperCase();

    if (!categoryId) {
      return NextResponse.json({ error: "Informe a categoria." }, { status: 400 });
    }

    const account = await getValidMercadoLivreAccount(empresaId);
    const [attributes, detail, categoryShipping, userShipping] = await Promise.all([
      mercadoLivreApiGet<MercadoLivreAttribute[]>(account.access_token, `/categories/${encodeURIComponent(categoryId)}/attributes`),
      mercadoLivreApiGet<CategoryDetail>(account.access_token, `/categories/${encodeURIComponent(categoryId)}`),
      mercadoLivreApiGet<ShippingPreferences>(account.access_token, `/categories/${encodeURIComponent(categoryId)}/shipping_preferences`),
      mercadoLivreApiGet<ShippingPreferences>(account.access_token, `/users/${account.ml_user_id}/shipping_preferences`),
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
        role: String(attribute.hierarchy ?? "").toUpperCase() === "PARENT_PK" || attribute.tags?.parent_pk
          ? "parent"
          : String(attribute.hierarchy ?? "").toUpperCase() === "CHILD_PK" || attribute.tags?.child_pk
            ? "child"
            : attribute.tags?.variation_attribute || attribute.tags?.allow_variations
              ? "variation"
              : "standard",
      }))
      .sort((a, b) => Number(b.required) - Number(a.required));

    const categoryModes = unique((categoryShipping.logistics ?? []).map((logistic) => logistic.mode));
    const userModes = unique([...(userShipping.modes ?? []), ...(userShipping.logistics ?? []).map((logistic) => logistic.mode)]);
    const availableModes = categoryModes.filter((mode) => userModes.includes(mode));
    const categoryMe2Types = logisticTypes(categoryShipping, "me2");
    const userMe2Types = logisticTypes(userShipping, "me2");
    const availableMe2Types = userMe2Types.length
      ? categoryMe2Types.filter((type) => userMe2Types.includes(type))
      : categoryMe2Types;

    return NextResponse.json({
      data,
      settings: {
        shippingOptions: availableModes,
        categoryShippingOptions: categoryModes,
        userShippingOptions: userModes,
        logisticOptions: availableMe2Types,
        categoryLogisticOptions: categoryMe2Types,
        userLogisticOptions: userMe2Types,
        me2Restricted: Boolean(categoryShipping.restricted),
        me2Restrictions: normalizeRestrictions(categoryShipping.me2_restrictions),
        userShippingOption: userShipping.option ?? null,
        defaultDimensions: categoryShipping.dimensions ?? null,
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

function unique(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean)));
}

function logisticTypes(preferences: ShippingPreferences, mode: string) {
  const logistics = (preferences.logistics ?? []).filter((logistic) => String(logistic.mode ?? "").toLowerCase() === mode);
  return unique(
    logistics.flatMap((logistic) =>
      (logistic.types ?? []).map((type) => (typeof type === "string" ? type : type?.type)),
    ),
  );
}

function normalizeRestrictions(value: ShippingPreferences["me2_restrictions"]) {
  if (Array.isArray(value)) return value.map(String);
  return value ? [String(value)] : [];
}
