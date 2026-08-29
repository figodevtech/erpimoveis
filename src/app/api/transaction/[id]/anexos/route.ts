export const runtime = "nodejs";

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { requireFinanceiroEdit, requireFinanceirosAccess } from "@/app/api/_authz/perms";
import {
  attachmentWithSignedUrl,
  existingUserId,
  isSupportedAttachment,
  MAX_ANEXOS_POR_TRANSACAO,
  MAX_TRANSACAO_ANEXO_SIZE,
  parsePositiveId,
  sanitizeAttachmentName,
  signedAttachmentUrl,
  TRANSACAO_ANEXOS_BUCKET,
  type TransacaoAnexoRow,
} from "@/app/api/transaction/_lib/anexos";
import { respostaSeEdicaoBloqueada } from "@/app/api/transaction/_lib/edicao";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Params = { params: Promise<{ id: string }> };
const SELECT_FIELDS =
  "id, transacao_id, nome, tipo, tamanho, path, descricao, created_by, created_at";

function errorResponse(error: unknown, fallback: string) {
  const known = error as { message?: string; statusCode?: number };
  const status = Number(known?.statusCode);
  return NextResponse.json(
    { error: known?.message ?? fallback },
    { status: [400, 401, 403, 404, 409, 413, 415].includes(status) ? status : 500 },
  );
}

async function transactionId(ctx: Params) {
  const { id } = await ctx.params;
  return parsePositiveId(id, "ID da transação");
}

async function ensureTransactionExists(id: number) {
  const { data, error } = await supabaseAdmin
    .from("transacao")
    .select("id")
    .eq("id", id)
    .eq("is_deleted", false)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const notFound = new Error("Transação não encontrada.");
    (notFound as Error & { statusCode?: number }).statusCode = 404;
    throw notFound;
  }
}

export async function GET(_request: NextRequest, ctx: Params) {
  try {
    await requireFinanceirosAccess();
    const id = await transactionId(ctx);
    await ensureTransactionExists(id);

    const { data, error } = await supabaseAdmin
      .from("transacao_anexo")
      .select(SELECT_FIELDS)
      .eq("transacao_id", id)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const items = await Promise.all(
      ((data ?? []) as TransacaoAnexoRow[]).map(attachmentWithSignedUrl),
    );
    return NextResponse.json({ items, maxAnexos: MAX_ANEXOS_POR_TRANSACAO });
  } catch (error) {
    console.error("GET /api/transaction/[id]/anexos", error);
    return errorResponse(error, "Erro ao listar anexos da transação.");
  }
}

export async function POST(request: NextRequest, ctx: Params) {
  let uploadedPath: string | null = null;

  try {
    await requireFinanceiroEdit();
    const bloqueio = await respostaSeEdicaoBloqueada();
    if (bloqueio) return bloqueio;

    const id = await transactionId(ctx);
    await ensureTransactionExists(id);

    const { count, error: countError } = await supabaseAdmin
      .from("transacao_anexo")
      .select("id", { count: "exact", head: true })
      .eq("transacao_id", id);
    if (countError) throw countError;
    if ((count ?? 0) >= MAX_ANEXOS_POR_TRANSACAO) {
      return NextResponse.json(
        { error: `Limite de ${MAX_ANEXOS_POR_TRANSACAO} anexos por transação atingido.` },
        { status: 409 },
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    const descricao = String(form.get("descricao") ?? "").trim() || null;
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Envie um arquivo em 'file'." }, { status: 400 });
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: "O arquivo está vazio." }, { status: 400 });
    }
    if (file.size > MAX_TRANSACAO_ANEXO_SIZE) {
      return NextResponse.json({ error: "Arquivo muito grande. Máximo: 10 MB." }, { status: 413 });
    }
    if (!isSupportedAttachment(file)) {
      return NextResponse.json(
        { error: "Tipo de arquivo inválido. Envie JPG, PNG, WebP ou PDF." },
        { status: 415 },
      );
    }

    const originalName = sanitizeAttachmentName(file.name);
    const isImage = file.type.startsWith("image/");
    let buffer: Buffer = Buffer.from(await file.arrayBuffer());
    let extension = "pdf";
    let contentType = "application/pdf";

    if (isImage) {
      const { default: sharp } = await import("sharp");
      try {
        buffer = await sharp(buffer)
          .rotate()
          .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
      } catch {
        return NextResponse.json({ error: "A imagem enviada é inválida ou está corrompida." }, { status: 415 });
      }
      extension = "webp";
      contentType = "image/webp";
    }

    uploadedPath = `transacao/${id}/anexos/${randomUUID()}.${extension}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(TRANSACAO_ANEXOS_BUCKET)
      .upload(uploadedPath, buffer, { contentType, upsert: false });
    if (uploadError) throw uploadError;

    const url = await signedAttachmentUrl(uploadedPath);
    const session = await auth();
    const createdBy = await existingUserId((session?.user as { id?: string } | undefined)?.id);

    const { data, error: insertError } = await supabaseAdmin
      .from("transacao_anexo")
      .insert({
        transacao_id: id,
        nome: originalName,
        tipo: contentType,
        tamanho: buffer.length,
        path: uploadedPath,
        descricao,
        created_by: createdBy,
      })
      .select(SELECT_FIELDS)
      .single();
    if (insertError) throw insertError;

    const { path: privatePath, ...metadata } = data as TransacaoAnexoRow;
    void privatePath;
    uploadedPath = null;
    return NextResponse.json({ item: { ...metadata, url } }, { status: 201 });
  } catch (error) {
    if (uploadedPath) {
      await supabaseAdmin.storage.from(TRANSACAO_ANEXOS_BUCKET).remove([uploadedPath]).catch(() => undefined);
    }
    console.error("POST /api/transaction/[id]/anexos", error);
    return errorResponse(error, "Erro ao anexar arquivo na transação.");
  }
}
