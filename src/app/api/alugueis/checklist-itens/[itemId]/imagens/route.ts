export const runtime = "nodejs";

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAlugueisEdit } from "@/app/api/_authz/perms";
import { ErroAluguel, respostaDeErro, usuarioDaSessao } from "@/lib/alugueis/server";

// Mesmo bucket e limites das fotos do checklist de saída da OS.
const BUCKET = "vistoria";
const MAX_FILES = 10;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

type RouteContext = { params: Promise<{ itemId: string }> };

function safeName(name: string) {
  return (name || "imagem").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(0, 120);
}

async function itemDoChecklist(valor: string) {
  const id = Number(valor);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ErroAluguel("Item inválido.", 400);
  const { data, error } = await supabaseAdmin
    .from("aluguel_checklist_item")
    .select("id, checklist:checklist_id ( id, aluguel_id )")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ErroAluguel("Item do checklist não encontrado.", 404);
  const checklist = data.checklist as unknown as { id: number; aluguel_id: number } | null;
  return { id, aluguelId: Number(checklist?.aluguel_id) };
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    await requireAlugueisEdit();
    const usuario = await usuarioDaSessao();
    const item = await itemDoChecklist((await context.params).itemId);

    const form = await req.formData();
    const files = form.getAll("files").filter((value) => value instanceof File) as File[];
    if (!files.length) throw new ErroAluguel("Nenhuma imagem enviada.", 400);
    if (files.length > MAX_FILES) throw new ErroAluguel(`Máximo de ${MAX_FILES} imagens por envio.`, 400);

    const inserted: unknown[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/") || file.size <= 0) throw new ErroAluguel(`${file.name}: arquivo de imagem inválido.`, 400);
      if (file.size > MAX_FILE_SIZE) throw new ErroAluguel(`${file.name}: a imagem excede 5 MB.`, 413);
      const original = safeName(file.name);
      const extension = original.includes(".") ? original.split(".").pop() : "";
      const path = `alugueis/${item.aluguelId}/${item.id}/${randomUUID()}${extension ? `.${extension}` : ""}`;
      const upload = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
      if (upload.error) throw upload.error;
      const { data: publicData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
      const saved = await supabaseAdmin
        .from("aluguel_checklist_imagem")
        .insert({ checklist_item_id: item.id, url: publicData.publicUrl, descricao: original || null, created_by: usuario })
        .select("id, url, descricao")
        .single();
      if (saved.error) {
        await supabaseAdmin.storage.from(BUCKET).remove([path]);
        throw saved.error;
      }
      inserted.push(saved.data);
    }
    return NextResponse.json({ items: inserted }, { status: 201 });
  } catch (error) {
    return respostaDeErro(error, "Falha ao enviar imagens.");
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    await requireAlugueisEdit();
    const item = await itemDoChecklist((await context.params).itemId);
    const imageId = Number(req.nextUrl.searchParams.get("imageId"));
    if (!Number.isSafeInteger(imageId) || imageId <= 0) throw new ErroAluguel("Imagem inválida.", 400);

    const { data, error } = await supabaseAdmin
      .from("aluguel_checklist_imagem")
      .select("id, url")
      .eq("id", imageId)
      .eq("checklist_item_id", item.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ErroAluguel("Imagem não encontrada.", 404);

    const removed = await supabaseAdmin
      .from("aluguel_checklist_imagem")
      .delete()
      .eq("id", imageId)
      .eq("checklist_item_id", item.id);
    if (removed.error) throw removed.error;

    const marker = `/object/public/${BUCKET}/`;
    const pathname = new URL(data.url).pathname;
    const index = pathname.indexOf(marker);
    if (index >= 0) {
      const cleanup = await supabaseAdmin.storage.from(BUCKET).remove([decodeURIComponent(pathname.slice(index + marker.length))]);
      if (cleanup.error) console.warn("Falha ao remover arquivo da foto", cleanup.error.message);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return respostaDeErro(error, "Falha ao excluir foto.");
  }
}
