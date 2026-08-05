export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import crypto from "crypto";

type Params = { checklistId: string };
const BUCKET = "vistoria";
const MAX_FILES = 10;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

function sanitizeFileName(name: string) {
  return (name || "imagem")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 120);
}

export async function POST(req: NextRequest, context: { params: Promise<Params> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const { checklistId } = await context.params;
    const checklistIdNum = Number(checklistId);
    if (!Number.isInteger(checklistIdNum) || checklistIdNum <= 0) {
      return NextResponse.json({ error: "checklistId inválido" }, { status: 400 });
    }

    // garante que checklist existe
    const ck = await supabaseAdmin
      .from("checklist")
      .select("id, ordemservicoid")
      .eq("id", checklistIdNum)
      .maybeSingle();

    if (ck.error) throw ck.error;
    if (!ck.data) return NextResponse.json({ error: "Checklist não encontrado" }, { status: 404 });

    const form = await req.formData();
    const files = form.getAll("files").filter((item) => item instanceof File) as File[];
    if (!files.length) return NextResponse.json({ error: "Nenhum arquivo enviado (files)" }, { status: 400 });
    if (files.length > MAX_FILES) {
      return NextResponse.json({ error: `Máximo de ${MAX_FILES} imagens por envio.` }, { status: 400 });
    }

    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        return NextResponse.json({ error: `${file.name}: o arquivo não é uma imagem.` }, { status: 400 });
      }
      if (file.size <= 0) {
        return NextResponse.json({ error: `${file.name}: o arquivo está vazio.` }, { status: 400 });
      }
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: `${file.name}: a imagem excede 5 MB.` }, { status: 413 });
      }
    }

    const inserted: any[] = [];

    for (const file of files) {
      const originalName = sanitizeFileName(file.name);
      const ext = originalName.includes(".") ? originalName.split(".").pop() : "";
      const finalName = `${crypto.randomUUID()}${ext ? "." + ext : ""}`;

      const path = `checklist/${checklistIdNum}/${finalName}`;
      const buf = Buffer.from(await file.arrayBuffer());

      const up = await supabaseAdmin.storage.from(BUCKET).upload(path, buf, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (up.error) throw up.error;

      const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
      const url = pub?.publicUrl;
      if (!url) throw new Error("Falha ao gerar publicUrl");

      const ins = await supabaseAdmin
        .from("imagemvistoria")
        .insert({ checklistid: checklistIdNum, url, descricao: originalName || null })
        .select("id, checklistid, url, descricao, createdat")
        .single();

      if (ins.error) {
        const cleanup = await supabaseAdmin.storage.from(BUCKET).remove([path]);
        if (cleanup.error) console.error("[POST checklist image] rollback storage error:", cleanup.error);
        throw ins.error;
      }
      inserted.push(ins.data);
    }

    return NextResponse.json({ items: inserted }, { status: 201 });
  } catch (err: any) {
    console.error("[POST] /api/checklists/[checklistId]/images/upload", err);
    return NextResponse.json({ error: err?.message || "Falha ao enviar imagens" }, { status: 500 });
  }
}
