import { NextRequest, NextResponse } from "next/server";
import { requireEstoqueAccess } from "@/app/api/_authz/perms";
import { errorStatus } from "@/lib/empresa-context";
import { getShopeeCategoryAttributes, getShopeeGatewayConnection, shopeeShopApi } from "@/lib/integrations/shopee";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireEstoqueAccess();
    const type = request.nextUrl.searchParams.get("type") || "logistics";
    const language = await getShopeeLanguage();
    if (type === "logistics") {
      const data = await shopeeShopApi<any>({ path: "/api/v2/logistics/get_channel_list" });
      return NextResponse.json({ data: data?.response?.logistics_channel_list ?? data?.response?.logistic_channel_list ?? [] });
    }
    if (type === "categories") {
      const data = await shopeeShopApi<any>({ path: "/api/v2/product/get_category", query: { language } });
      const categories = (data?.response?.category_list ?? []).map((category: any) => ({
        id: Number(category?.category_id) || 0,
        parentId: Number(category?.parent_category_id) || 0,
        name: String(category?.display_category_name ?? category?.original_category_name ?? category?.category_name ?? category?.category_id ?? "").trim(),
        hasChildren: Boolean(category?.has_children),
      })).filter((category: any) => category.id && category.name);
      return NextResponse.json({ data: categories });
    }
    if (type === "recommend-category") {
      const itemName = String(request.nextUrl.searchParams.get("itemName") || "").trim();
      if (!itemName) return NextResponse.json({ error: "Informe o nome do produto." }, { status: 400 });
      const data = await shopeeShopApi<any>({ path: "/api/v2/product/category_recommend", query: { item_name: itemName } });
      return NextResponse.json({ data: data?.response ?? {} });
    }
    if (type === "attributes") {
      const categoryId = Number(request.nextUrl.searchParams.get("categoryId"));
      if (!Number.isInteger(categoryId) || categoryId <= 0) return NextResponse.json({ error: "Categoria inválida." }, { status: 400 });
      const rawAttributes = await getShopeeCategoryAttributes(categoryId, language);
      const attributes = rawAttributes.map(normalizeAttribute).filter((attribute: any) => attribute.id && attribute.name);
      return NextResponse.json({ data: attributes });
    }
    if (type === "brands") {
      const categoryId = Number(request.nextUrl.searchParams.get("categoryId"));
      const offset = Math.max(0, Number(request.nextUrl.searchParams.get("offset") || 0));
      if (!Number.isInteger(categoryId) || categoryId <= 0) return NextResponse.json({ error: "Categoria inválida." }, { status: 400 });
      const data = await shopeeShopApi<any>({ path: "/api/v2/product/get_brand_list", query: { category_id: categoryId, offset, page_size: 100, status: 1 } });
      const brands = (data?.response?.brand_list ?? []).map((brand: any) => ({
        id: Number(brand?.brand_id) || 0,
        name: String(brand?.display_brand_name ?? brand?.original_brand_name ?? brand?.brand_name ?? brand?.brand_id ?? "").trim(),
      })).filter((brand: any) => brand.name);
      return NextResponse.json({ data: brands, hasNextPage: Boolean(data?.response?.has_next_page) });
    }
    return NextResponse.json({ error: "Consulta de metadados inválida." }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Falha ao consultar dados da Shopee." }, { status: errorStatus(error) });
  }
}

async function getShopeeLanguage() {
  try {
    const connection = await getShopeeGatewayConnection();
    const region = String(connection.account?.region || "").toUpperCase();
    return ({ BR: "pt-br", TH: "th", VN: "vi", ID: "id", MY: "ms", TW: "zh-hant", PL: "pl", MX: "es", CO: "es", CL: "es" } as Record<string, string>)[region] || "en";
  } catch {
    return "en";
  }
}

function normalizeAttribute(attribute: any) {
  const values = (attribute?.attribute_value_list ?? attribute?.values ?? []).map((value: any) => ({
    id: Number(value?.value_id ?? value?.id) || null,
    name: String(value?.original_value_name ?? value?.display_value_name ?? value?.value_name ?? value?.name ?? "").trim(),
    unit: String(value?.value_unit ?? value?.unit ?? "").trim() || null,
  })).filter((value: any) => value.name);
  return {
    id: Number(attribute?.attribute_id ?? attribute?.id) || 0,
    name: String(attribute?.original_attribute_name ?? attribute?.display_attribute_name ?? attribute?.attribute_name ?? attribute?.name ?? "").trim(),
    required: Boolean(attribute?.is_mandatory ?? attribute?.mandatory ?? attribute?.required),
    inputType: String(attribute?.input_type ?? attribute?.attribute_info?.input_type ?? attribute?.input_validation_type ?? attribute?.attribute_info?.input_validation_type ?? attribute?.format_type ?? attribute?.attribute_info?.format_type ?? "TEXT_FILED").toUpperCase(),
    allowCustomValue: Boolean(attribute?.is_customized ?? attribute?.allow_custom_value ?? values.length === 0),
    units: Array.from(new Set((attribute?.attribute_unit ?? attribute?.unit_list ?? []).map((unit: any) => String(unit?.value_unit ?? unit?.unit ?? unit ?? "").trim()).filter(Boolean))),
    values,
  };
}
