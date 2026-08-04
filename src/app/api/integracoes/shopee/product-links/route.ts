import { NextResponse, type NextRequest } from "next/server";
import { requireEstoqueAccess, requireEstoqueEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    await requireEstoqueAccess();
    const empresaId = await requireEmpresaId();
    const { data, error } = await supabaseAdmin.from("shopee_product_link").select("*").eq("empresa_id", empresaId).order("updated_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ links: data ?? [] });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Falha ao consultar vínculos Shopee." }, { status: errorStatus(error) });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireEstoqueEdit();
    const empresaId = await requireEmpresaId();
    const body = await req.json();
    const produtoId = Number(body.produtoId);
    const itemId = Number(body.itemId);
    const modelId = body.modelId === null || body.modelId === undefined || body.modelId === "" ? null : Number(body.modelId);
    if (!Number.isInteger(produtoId) || produtoId <= 0 || !Number.isInteger(itemId) || itemId <= 0) {
      return NextResponse.json({ error: "Produto e Item ID da Shopee são obrigatórios." }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin.from("shopee_product_link").upsert({
      empresa_id: empresaId,
      produto_id: produtoId,
      item_id: itemId,
      model_id: Number.isInteger(modelId) && Number(modelId) > 0 ? modelId : null,
      item_sku: body.itemSku || null,
      model_sku: body.modelSku || null,
      title: body.title || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "empresa_id,produto_id" }).select().single();
    if (error) throw error;
    return NextResponse.json({ ok: true, link: data });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Falha ao salvar vínculo Shopee." }, { status: errorStatus(error) });
  }
}
