import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { requireEmpresaId } from "@/lib/empresa-context";
import { getValidMercadoLivreAccount } from "@/lib/integrations/mercadolivre-account";
import { mercadoLivreApiGet } from "@/lib/integrations/mercadolivre";
import {
  mercadoEnviosLogisticLabel,
  pickMercadoEnviosLogisticType,
  type MercadoLivreShippingPreferences,
} from "@/lib/integrations/mercadolivre-mercado-envios";
import { buildPreferencesInspection } from "@/lib/integrations/mercadolivre-shipping-preferences";

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

type ShippingPreferences = MercadoLivreShippingPreferences;

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
      // Uma preferência indisponível não pode derrubar os atributos da categoria:
      // sem resposta, quem decide o Mercado Envios é o `shipping_modes` do anúncio.
      mercadoLivreApiGet<ShippingPreferences>(account.access_token, `/categories/${encodeURIComponent(categoryId)}/shipping_preferences`).catch(() => null),
      mercadoLivreApiGet<ShippingPreferences>(account.access_token, `/users/${account.ml_user_id}/shipping_preferences`).catch(() => null),
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

    const inspection = buildPreferencesInspection(categoryShipping, userShipping);

    // Sem esse registro não há como saber, depois, qual lado recusou o Mercado
    // Envios. Nenhum token entra no log.
    console.info("mercado-envios preferences", {
      empresa_id: account.empresa_id,
      ml_user_id: account.ml_user_id,
      category_id: categoryId,
      category_modes: inspection.categoryModes,
      user_modes: inspection.userModes,
      category_me2_types: inspection.categoryLogistics.map((option) => option.type),
      user_me2_types: inspection.userLogistics.map((option) => option.type),
      me2_restricted: inspection.me2Restricted,
      category_preferences_ok: categoryShipping != null,
      user_preferences_ok: userShipping != null,
    });

    return NextResponse.json({
      data,
      settings: {
        shippingOptions: inspection.availableModes,
        categoryShippingOptions: inspection.categoryModes,
        userShippingOptions: inspection.userModes,
        logisticOptions: inspection.logistics.map((option) => option.type),
        logistics: inspection.logistics.map((option) => ({
          type: option.type,
          default: option.default,
          label: mercadoEnviosLogisticLabel(option.type),
        })),
        defaultLogisticOption: pickMercadoEnviosLogisticType(inspection.logistics),
        categoryLogisticOptions: inspection.categoryLogistics.map((option) => option.type),
        userLogisticOptions: inspection.userLogistics.map((option) => option.type),
        me2Restricted: inspection.me2Restricted,
        me2Restrictions: inspection.me2Restrictions,
        userShippingOption: inspection.userShippingOption,
        defaultDimensions: inspection.defaultDimensions,
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



