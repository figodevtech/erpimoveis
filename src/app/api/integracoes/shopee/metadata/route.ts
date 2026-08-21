import { NextRequest, NextResponse } from "next/server";
import { requireEstoqueAccess } from "@/app/api/_authz/perms";
import { errorStatus } from "@/lib/empresa-context";
import { getShopeeCategoryAttributes, getShopeeLanguage, shopeeShopApi } from "@/lib/integrations/shopee";
import { normalizeShopeeAttribute, normalizeShopeeLogisticsChannel } from "@/lib/integrations/shopee-listing";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireEstoqueAccess();
    const type = request.nextUrl.searchParams.get("type") || "logistics";
    const language = await getShopeeLanguage();
    if (type === "logistics") {
      const data = await shopeeShopApi<any>({ path: "/api/v2/logistics/get_channel_list" });
      const channels = (data?.response?.logistics_channel_list ?? data?.response?.logistic_channel_list ?? [])
        .map(normalizeShopeeLogisticsChannel)
        .filter(Boolean)
        .map((channel: any) => ({
          ...channel,
          logistics_channel_id: channel.id,
          logistics_channel_name: channel.name,
        }));
      return NextResponse.json({ data: channels });
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
      const attributes = rawAttributes.map((attribute: any) => normalizeShopeeAttribute(attribute, language)).filter(Boolean);
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
        originalName: String(brand?.original_brand_name ?? brand?.brand_name ?? brand?.display_brand_name ?? "").trim(),
      })).filter((brand: any) => brand.name);
      return NextResponse.json({
        data: brands,
        required: Boolean(data?.response?.is_mandatory),
        inputType: data?.response?.input_type ?? null,
        hasNextPage: Boolean(data?.response?.has_next_page),
        nextOffset: Number(data?.response?.next_offset) || null,
      });
    }
    return NextResponse.json({ error: "Consulta de metadados inválida." }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Falha ao consultar dados da Shopee." }, { status: errorStatus(error) });
  }
}
