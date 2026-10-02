export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  consolidarEnvioDireto,
  descartarEnvioDireto,
  processarImagem,
  type ArquivoConsolidado,
} from "@/lib/anexos/envio-direto";
import {
  VENDA_ANEXO_CATEGORIA_VALUES,
  type VendaAnexoCategoria,
} from "@/lib/venda-anexo-categorias";
import {
  BUCKET,
  ensureBucket,
  exigirVagaNaVenda,
  MAX_ANEXOS_POR_VENDA,
  MAX_FILE_SIZE,
  parseId,
  prefixoDaVenda,
  respostaDeErro,
  type Params,
} from "./_lib/anexos";

const VENDA_ANEXO_CATEGORIAS_SET = new Set(VENDA_ANEXO_CATEGORIA_VALUES);

function sanitizeFileName(name: string) {
  return (name || "anexo")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 120);
}

function extFromFile(file: File) {
  const name = String(file.name || "").toLowerCase();
  const match = name.match(/\.([a-z0-9]+)$/);
  if (match?.[1]) return match[1];

  const type = String(file.type || "").toLowerCase();
  if (type === "application/pdf") return "pdf";
  if (type === "image/png") return "png";
  if (type === "image/jpeg") return "jpg";
  if (type === "image/webp") return "webp";
  return "bin";
}

function isImageFile(file: File) {
  return String(file.type || "").toLowerCase().startsWith("image/");
}

function lerCategoria(value: unknown): VendaAnexoCategoria {
  const categoriaRaw = String(value ?? "OUTROS").trim().toUpperCase();
  return VENDA_ANEXO_CATEGORIAS_SET.has(categoriaRaw as VendaAnexoCategoria)
    ? (categoriaRaw as VendaAnexoCategoria)
    : "OUTROS";
}

/**
 * Envio antigo, com o arquivo no corpo. Só cabe até 4,5 MB na Vercel; fica
 * para as abas que ainda rodam o cliente anterior ao envio direto.
 */
async function receberFormulario(req: NextRequest, vendaId: number) {
  const form = await req.formData();
  const file = form.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Envie um arquivo em 'file'." }, { status: 400 });
  }

  const fileType = String(file.type || "").toLowerCase();
  if (fileType !== "application/pdf" && !isImageFile(file)) {
    return NextResponse.json({ error: "Tipo de arquivo inválido. Envie imagem ou PDF." }, { status: 400 });
  }

  if (typeof file.size === "number" && file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "Arquivo muito grande. Máximo: 10MB." }, { status: 400 });
  }

  let ext = extFromFile(file);
  let contentType = file.type || "application/octet-stream";
  let buffer: Buffer = Buffer.from(await file.arrayBuffer());

  if (isImageFile(file)) {
    buffer = await processarImagem(buffer);
    ext = "webp";
    contentType = "image/webp";
  }

  const path = `${prefixoDaVenda(vendaId)}${randomUUID()}.${ext}`;

  await ensureBucket();

  const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(path, buffer, {
    contentType,
    upsert: false,
  });

  if (uploadError) {
    return NextResponse.json(
      { error: `Falha ao enviar anexo (bucket: ${BUCKET}): ${uploadError.message}` },
      { status: 500 },
    );
  }

  return {
    arquivo: { path, tipo: contentType, tamanho: buffer.length } satisfies ArquivoConsolidado,
    nome: file.name,
    descricao: form.get("descricao"),
    categoria: form.get("categoria"),
  };
}

export async function GET(_req: NextRequest, context: { params: Promise<Params> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const vendaId = await parseId(context);
    const { data, error } = await supabaseAdmin
      .from("vendaanexo")
      .select("id, vendaid, nome, tipo, tamanho, url, path, descricao, categoria, createdat")
      .eq("vendaid", vendaId)
      .order("createdat", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ items: data ?? [], maxAnexos: MAX_ANEXOS_POR_VENDA }, { status: 200 });
  } catch (error: any) {
    console.error("GET /api/venda/[id]/anexos", error);
    return respostaDeErro(error, "Erro ao listar anexos.");
  }
}

/**
 * Registra o anexo. O corpo JSON é a etapa 2 do envio direto (`./envio`):
 * traz só o caminho do arquivo que o navegador já subiu ao Storage.
 */
export async function POST(req: NextRequest, context: { params: Promise<Params> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const vendaId = await parseId(context);
    const prefixo = prefixoDaVenda(vendaId);
    const envioDireto = (req.headers.get("content-type") ?? "").includes("application/json");
    const body = envioDireto ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : null;

    try {
      await exigirVagaNaVenda(vendaId);
    } catch (error) {
      if (body) await descartarEnvioDireto(BUCKET, prefixo, body.path);
      throw error;
    }

    const recebido = body
      ? {
          arquivo: await consolidarEnvioDireto({
            bucket: BUCKET,
            prefixo,
            path: body.path,
            maxBytes: MAX_FILE_SIZE,
          }),
          nome: body.nome,
          descricao: body.descricao,
          categoria: body.categoria,
        }
      : await receberFormulario(req, vendaId);
    if (recebido instanceof NextResponse) return recebido;

    const { arquivo } = recebido;
    const { data: publicData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(arquivo.path);
    const publicUrl = publicData?.publicUrl;
    if (!publicUrl) {
      await supabaseAdmin.storage.from(BUCKET).remove([arquivo.path]);
      return NextResponse.json({ error: "Falha ao gerar URL pública do anexo." }, { status: 500 });
    }

    const { data: saved, error: insertError } = await supabaseAdmin
      .from("vendaanexo")
      .insert({
        vendaid: vendaId,
        nome: sanitizeFileName(String(recebido.nome ?? "")),
        tipo: arquivo.tipo,
        tamanho: arquivo.tamanho,
        url: publicUrl,
        path: arquivo.path,
        descricao: String(recebido.descricao ?? "").trim() || null,
        categoria: lerCategoria(recebido.categoria),
      })
      .select("id, vendaid, nome, tipo, tamanho, url, path, descricao, categoria, createdat")
      .single();

    if (insertError) {
      await supabaseAdmin.storage.from(BUCKET).remove([arquivo.path]);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ item: saved }, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/venda/[id]/anexos", error);
    return respostaDeErro(error, "Erro ao anexar arquivo.");
  }
}
