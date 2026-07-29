export const runtime = "nodejs";

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { PERMS, requireAny, requireUsoConsumoAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { usoConsumoError } from "@/lib/usoconsumo/api";

const BUCKET = "produto_imagem";
type Context = { params: Promise<{ id: string }> };
async function idOf(context: Context) { const id = Number((await context.params).id); if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error("Item inválido."), { statusCode: 400 }); return id; }

export async function GET(_req: NextRequest, context: Context) {
  try {
    await requireUsoConsumoAccess();
    const { data, error } = await supabaseAdmin.from("usoconsumo_item_imagem").select("id,item_id,url,ordem,created_at").eq("item_id", await idOf(context)).order("ordem");
    if (error) throw error;
    return NextResponse.json({ imagens: data ?? [] });
  } catch (error) { return usoConsumoError(error, "Erro ao listar imagens."); }
}

export async function POST(req: NextRequest, context: Context) {
  const uploadedPaths: string[] = [];
  try {
    await requireAny([PERMS.USOCONSUMO_CRIAR, PERMS.USOCONSUMO_EDITAR]);
    const itemId = await idOf(context);
    const { data: item, error: itemError } = await supabaseAdmin.from("usoconsumo_item").select("id,img_url").eq("id", itemId).maybeSingle();
    if (itemError) throw itemError;
    if (!item) return NextResponse.json({ error: "Item não encontrado." }, { status: 404 });
    const files = (await req.formData()).getAll("files").filter((file): file is File => file instanceof File);
    if (!files.length || files.length > 10) return NextResponse.json({ error: "Envie de uma a dez imagens." }, { status: 400 });
    if (files.some((file) => !file.type.startsWith("image/") || file.size > 10_000_000)) return NextResponse.json({ error: "Use somente imagens de até 10 MB." }, { status: 400 });
    const { default: sharp } = await import("sharp");
    const { data: last, error: lastError } = await supabaseAdmin.from("usoconsumo_item_imagem").select("ordem").eq("item_id", itemId).order("ordem", { ascending: false }).limit(1);
    if (lastError) throw lastError;
    let order = Number(last?.[0]?.ordem ?? 0);
    const rows: Array<{ item_id: number; url: string; path: string; ordem: number }> = [];
    for (const file of files) {
      const buffer = await sharp(Buffer.from(await file.arrayBuffer())).rotate().resize(1200,1200,{ fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      const path = `usoconsumo/${itemId}/${randomUUID()}.webp`;
      const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, buffer, { contentType: "image/webp", upsert: false });
      if (error) throw error;
      uploadedPaths.push(path);
      const { data: publicData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
      rows.push({ item_id: itemId, path, url: publicData.publicUrl, ordem: ++order });
    }
    const { data, error } = await supabaseAdmin.from("usoconsumo_item_imagem").insert(rows).select("id,item_id,url,ordem,created_at");
    if (error) throw error;
    if (!item.img_url && data?.[0]) await supabaseAdmin.from("usoconsumo_item").update({ img_url: data[0].url, updated_at: new Date().toISOString() }).eq("id", itemId).is("img_url", null);
    return NextResponse.json({ imagens: data ?? [] }, { status: 201 });
  } catch (error) {
    if (uploadedPaths.length) await supabaseAdmin.storage.from(BUCKET).remove(uploadedPaths);
    return usoConsumoError(error, "Erro ao enviar imagens.");
  }
}

export async function PATCH(req: NextRequest, context: Context) {
  try {
    await requireAny([PERMS.USOCONSUMO_CRIAR, PERMS.USOCONSUMO_EDITAR]);
    const itemId = await idOf(context);
    const imageIds = (await req.json().catch(() => null))?.imageIds;
    if (!Array.isArray(imageIds) || imageIds.some((id) => !Number.isInteger(Number(id)) || Number(id) <= 0)) {
      return NextResponse.json({ error: "Informe a ordem válida das imagens." }, { status: 400 });
    }

    const normalizedIds = imageIds.map(Number);
    if (new Set(normalizedIds).size !== normalizedIds.length) {
      return NextResponse.json({ error: "A ordem possui imagens duplicadas." }, { status: 400 });
    }

    const { data: current, error: currentError } = await supabaseAdmin
      .from("usoconsumo_item_imagem")
      .select("id")
      .eq("item_id", itemId);
    if (currentError) throw currentError;
    const currentIds = (current ?? []).map((image) => Number(image.id)).sort((a, b) => a - b);
    const requestedIds = [...normalizedIds].sort((a, b) => a - b);
    if (currentIds.length !== requestedIds.length || currentIds.some((id, index) => id !== requestedIds[index])) {
      return NextResponse.json({ error: "A ordem deve conter todas as imagens atuais do item." }, { status: 409 });
    }

    for (const [index, imageId] of normalizedIds.entries()) {
      const { error } = await supabaseAdmin
        .from("usoconsumo_item_imagem")
        .update({ ordem: index + 1 })
        .eq("id", imageId)
        .eq("item_id", itemId);
      if (error) throw error;
    }

    const { data, error } = await supabaseAdmin
      .from("usoconsumo_item_imagem")
      .select("id,item_id,url,ordem,created_at")
      .eq("item_id", itemId)
      .order("ordem");
    if (error) throw error;
    return NextResponse.json({ imagens: data ?? [] });
  } catch (error) {
    return usoConsumoError(error, "Erro ao salvar a ordem das imagens.");
  }
}
