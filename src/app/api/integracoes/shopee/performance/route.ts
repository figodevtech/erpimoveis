import { NextResponse } from "next/server";
import { requireEstoqueAccess } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { shopeeShopApi } from "@/lib/integrations/shopee";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireEstoqueAccess();
    const empresaId = await requireEmpresaId();
    const { data: links, error } = await supabaseAdmin
      .from("shopee_product_link")
      .select("produto_id, item_id, title, status")
      .eq("empresa_id", empresaId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    const itemIds = Array.from(new Set((links ?? []).map((link: any) => Number(link.item_id)).filter(Boolean))).slice(0, 100);
    const metrics: any[] = [];
    for (let index = 0; index < itemIds.length; index += 50) {
      const response = await shopeeShopApi<any>({
        path: "/api/v2/product/get_item_extra_info",
        query: { item_id_list: itemIds.slice(index, index + 50).join(",") },
      });
      metrics.push(...(response?.response?.item_list ?? []));
    }
    const linkByItem = new Map((links ?? []).map((link: any) => [Number(link.item_id), link]));
    const items = metrics.map((metric: any) => ({ ...metric, link: linkByItem.get(Number(metric.item_id)) ?? null }));
    return NextResponse.json({
      items,
      summary: {
        views: items.reduce((sum, item) => sum + Number(item.views || item.view_count || 0), 0),
        likes: items.reduce((sum, item) => sum + Number(item.likes || item.like_count || 0), 0),
        sales: items.reduce((sum, item) => sum + Number(item.sale || item.sold || item.sold_quantity || 0), 0),
        comments: items.reduce((sum, item) => sum + Number(item.comment_count || item.rating_count || 0), 0),
      },
    });
  } catch (error: any) {
    const message = String(error?.message || "Falha ao consultar desempenho Shopee.");
    const friendly = /permission|not authorized/i.test(message)
      ? "A conta ou o aplicativo ainda não possui permissão para consultar métricas de produtos da Shopee."
      : message;
    return NextResponse.json({ error: friendly }, { status: errorStatus(error) });
  }
}
