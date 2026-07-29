import { NextRequest, NextResponse } from "next/server";
import { requireUsoConsumoEdit } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { usoConsumoError } from "@/lib/usoconsumo/api";

const BUCKET = "produto_imagem";
type Context = { params: Promise<{ id: string; imageId: string }> };
async function ids(context: Context) { const p = await context.params; const itemId = Number(p.id); const imageId = Number(p.imageId); if (![itemId,imageId].every((id) => Number.isInteger(id) && id > 0)) throw Object.assign(new Error("Imagem inválida."), { statusCode: 400 }); return { itemId,imageId }; }

export async function PATCH(req: NextRequest, context: Context) {
  try {
    await requireUsoConsumoEdit();
    if ((await req.json().catch(() => ({})))?.principal !== true) return NextResponse.json({ error: "Envie { principal: true }." }, { status: 400 });
    const { itemId,imageId } = await ids(context);
    const { data: image, error } = await supabaseAdmin.from("usoconsumo_item_imagem").select("url").eq("id", imageId).eq("item_id", itemId).maybeSingle();
    if (error) throw error;
    if (!image) return NextResponse.json({ error: "Imagem não encontrada." }, { status: 404 });
    const { error: updateError } = await supabaseAdmin.from("usoconsumo_item").update({ img_url: image.url, updated_at: new Date().toISOString() }).eq("id", itemId);
    if (updateError) throw updateError;
    return NextResponse.json({ ok: true, img_url: image.url });
  } catch (error) { return usoConsumoError(error, "Erro ao definir imagem principal."); }
}

export async function DELETE(_req: NextRequest, context: Context) {
  try {
    await requireUsoConsumoEdit();
    const { itemId,imageId } = await ids(context);
    const { data: image, error } = await supabaseAdmin.from("usoconsumo_item_imagem").select("path,url").eq("id", imageId).eq("item_id", itemId).maybeSingle();
    if (error) throw error;
    if (!image) return NextResponse.json({ error: "Imagem não encontrada." }, { status: 404 });
    const { error: removeError } = await supabaseAdmin.storage.from(BUCKET).remove([image.path]);
    if (removeError) throw removeError;
    const { error: deleteError } = await supabaseAdmin.from("usoconsumo_item_imagem").delete().eq("id", imageId).eq("item_id", itemId);
    if (deleteError) throw deleteError;
    const { data: nextImage } = await supabaseAdmin.from("usoconsumo_item_imagem").select("url").eq("item_id", itemId).order("ordem").limit(1).maybeSingle();
    await supabaseAdmin.from("usoconsumo_item").update({ img_url: nextImage?.url ?? null, updated_at: new Date().toISOString() }).eq("id", itemId).eq("img_url", image.url);
    return new NextResponse(null, { status: 204 });
  } catch (error) { return usoConsumoError(error, "Erro ao excluir imagem."); }
}

