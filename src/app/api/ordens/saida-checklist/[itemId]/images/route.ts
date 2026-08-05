export const runtime = "nodejs";

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireOSEdit } from "@/app/api/_authz/perms";

const BUCKET = "vistoria";
const MAX_FILES = 10;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

function safeName(name: string) {
  return (name || "imagem").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w.\-]+/g, "_").slice(0, 120);
}

export async function POST(req: NextRequest, context: { params: Promise<{ itemId: string }> }) {
  try {
    await requireOSEdit();
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

    const { itemId } = await context.params;
    const id = Number(itemId);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Item inválido." }, { status: 400 });
    const item = await supabaseAdmin.from("os_saida_checklist_item").select("id, os_saida_id").eq("id", id).maybeSingle();
    if (item.error) throw item.error;
    if (!item.data) return NextResponse.json({ error: "Item do checklist não encontrado." }, { status: 404 });

    const form = await req.formData();
    const files = form.getAll("files").filter((value) => value instanceof File) as File[];
    if (!files.length) return NextResponse.json({ error: "Nenhuma imagem enviada." }, { status: 400 });
    if (files.length > MAX_FILES) return NextResponse.json({ error: `Máximo de ${MAX_FILES} imagens por envio.` }, { status: 400 });

    const inserted: any[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/") || file.size <= 0) throw new Error(`${file.name}: arquivo de imagem inválido.`);
      if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: `${file.name}: a imagem excede 5 MB.` }, { status: 413 });
      const original = safeName(file.name);
      const extension = original.includes(".") ? original.split(".").pop() : "";
      const path = `os-saida/${item.data.os_saida_id}/${id}/${crypto.randomUUID()}${extension ? `.${extension}` : ""}`;
      const upload = await supabaseAdmin.storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
      if (upload.error) throw upload.error;
      const { data: publicData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
      const saved = await supabaseAdmin.from("os_saida_checklist_imagem").insert({ checklist_item_id: id, url: publicData.publicUrl, descricao: original || null, created_by: userId }).select("id, url, descricao, created_at").single();
      if (saved.error) {
        await supabaseAdmin.storage.from(BUCKET).remove([path]);
        throw saved.error;
      }
      inserted.push(saved.data);
    }
    return NextResponse.json({ items: inserted }, { status: 201 });
  } catch (error: any) {
    console.error("POST checklist de saída images", error);
    return NextResponse.json({ error: error?.message || "Falha ao enviar imagens." }, { status: 500 });
  }
}
