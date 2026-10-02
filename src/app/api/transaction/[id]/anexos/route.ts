export const runtime = "nodejs";

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { requireFinanceiroEdit, requireFinanceirosAccess } from "@/app/api/_authz/perms";
import {
  attachmentPrefix,
  attachmentWithSignedUrl,
  ensureAttachmentSlot,
  ensureAttachmentTransaction,
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
import {
  consolidarEnvioDireto,
  descartarEnvioDireto,
  processarImagem,
  type ArquivoConsolidado,
} from "@/lib/anexos/envio-direto";
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

/**
 * Envio antigo, com o arquivo no corpo. Só cabe até 4,5 MB na Vercel; fica
 * para as abas que ainda rodam o cliente anterior ao envio direto.
 */
async function receberFormulario(request: NextRequest, id: number) {
  const form = await request.formData();
  const file = form.get("file");
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

  const isImage = file.type.startsWith("image/");
  let buffer: Buffer = Buffer.from(await file.arrayBuffer());
  let extension = "pdf";
  let contentType = "application/pdf";

  if (isImage) {
    try {
      buffer = await processarImagem(buffer);
    } catch {
      return NextResponse.json({ error: "A imagem enviada é inválida ou está corrompida." }, { status: 415 });
    }
    extension = "webp";
    contentType = "image/webp";
  }

  const path = `${attachmentPrefix(id)}${randomUUID()}.${extension}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(TRANSACAO_ANEXOS_BUCKET)
    .upload(path, buffer, { contentType, upsert: false });
  if (uploadError) throw uploadError;

  return {
    arquivo: { path, tipo: contentType, tamanho: buffer.length } satisfies ArquivoConsolidado,
    nome: file.name,
    descricao: form.get("descricao"),
  };
}

export async function GET(_request: NextRequest, ctx: Params) {
  try {
    await requireFinanceirosAccess();
    const id = await transactionId(ctx);
    await ensureAttachmentTransaction(id, "ler");

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

/**
 * Registra o anexo. O corpo JSON é a etapa 2 do envio direto (`./envio`):
 * traz só o caminho do arquivo que o navegador já subiu ao Storage.
 */
export async function POST(request: NextRequest, ctx: Params) {
  let uploadedPath: string | null = null;
  let body: Record<string, unknown> | null = null;
  let prefix = "";

  try {
    await requireFinanceiroEdit();
    const bloqueio = await respostaSeEdicaoBloqueada();
    if (bloqueio) return bloqueio;

    const id = await transactionId(ctx);
    prefix = attachmentPrefix(id);
    if ((request.headers.get("content-type") ?? "").includes("application/json")) {
      body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    }

    await ensureAttachmentTransaction(id, "alterar");
    await ensureAttachmentSlot(id);

    const recebido = body
      ? {
          arquivo: await consolidarEnvioDireto({
            bucket: TRANSACAO_ANEXOS_BUCKET,
            prefixo: prefix,
            path: body.path,
            maxBytes: MAX_TRANSACAO_ANEXO_SIZE,
          }),
          nome: body.nome,
          descricao: body.descricao,
        }
      : await receberFormulario(request, id);
    if (recebido instanceof NextResponse) return recebido;

    // Daqui em diante o objeto é deste anexo: falhas o removem pelo caminho
    // final, não pelo caminho enviado pelo navegador.
    body = null;
    uploadedPath = recebido.arquivo.path;

    const url = await signedAttachmentUrl(uploadedPath);
    const session = await auth();
    const createdBy = await existingUserId((session?.user as { id?: string } | undefined)?.id);

    const { data, error: insertError } = await supabaseAdmin
      .from("transacao_anexo")
      .insert({
        transacao_id: id,
        nome: sanitizeAttachmentName(String(recebido.nome ?? "")),
        tipo: recebido.arquivo.tipo,
        tamanho: recebido.arquivo.tamanho,
        path: uploadedPath,
        descricao: String(recebido.descricao ?? "").trim() || null,
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
    } else if (body && prefix) {
      await descartarEnvioDireto(TRANSACAO_ANEXOS_BUCKET, prefix, body.path);
    }
    console.error("POST /api/transaction/[id]/anexos", error);
    return errorResponse(error, "Erro ao anexar arquivo na transação.");
  }
}
