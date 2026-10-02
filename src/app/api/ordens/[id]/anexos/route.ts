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
  OS_ANEXO_CATEGORIA_VALUES,
  type OsAnexoCategoria,
} from "@/lib/os-anexo-categorias";
import {
  BUCKET,
  ensureBucket,
  exigirVagaNaOs,
  MAX_ANEXOS_POR_OS,
  MAX_FILE_SIZE,
  parseId,
  prefixoDaOs,
  respostaDeErro,
  type Params,
} from "./_lib/anexos";

const OS_ANEXO_CATEGORIAS_SET = new Set(OS_ANEXO_CATEGORIA_VALUES);

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

function lerCategoria(value: unknown): OsAnexoCategoria {
  const categoriaRaw = String(value ?? "OUTROS").trim().toUpperCase();
  return OS_ANEXO_CATEGORIAS_SET.has(categoriaRaw as OsAnexoCategoria)
    ? (categoriaRaw as OsAnexoCategoria)
    : "OUTROS";
}

/**
 * Envio antigo, com o arquivo no corpo. Só cabe até 4,5 MB na Vercel; fica
 * para as abas que ainda rodam o cliente anterior ao envio direto.
 */
async function receberFormulario(req: NextRequest, osId: number) {
  const form = await req.formData();
  const file = form.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Envie um arquivo em 'file'." }, { status: 400 });
  }

  const fileType = String(file.type || "").toLowerCase();
  if (fileType !== "application/pdf" && !isImageFile(file)) {
    return NextResponse.json({ error: "Tipo de arquivo invalido. Envie imagem ou PDF." }, { status: 400 });
  }

  if (typeof file.size === "number" && file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "Arquivo muito grande. Maximo: 10MB." }, { status: 400 });
  }

  let ext = extFromFile(file);
  let contentType = file.type || "application/octet-stream";
  let buffer: Buffer = Buffer.from(await file.arrayBuffer());

  if (isImageFile(file)) {
    buffer = await processarImagem(buffer);
    ext = "webp";
    contentType = "image/webp";
  }

  const path = `${prefixoDaOs(osId)}${randomUUID()}.${ext}`;
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
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const osId = await parseId(context);
    const { data, error } = await supabaseAdmin
      .from("osanexo")
      .select("id, ordemservicoid, nome, tipo, tamanho, url, path, descricao, categoria, createdat")
      .eq("ordemservicoid", osId)
      .order("createdat", { ascending: false });

    if (error) {
      if (error.code === "42P01") {
        return NextResponse.json({ items: [] }, { status: 200 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ items: data ?? [], maxAnexos: MAX_ANEXOS_POR_OS }, { status: 200 });
  } catch (error: any) {
    console.error("GET /api/ordens/[id]/anexos", error);
    return respostaDeErro(error, "Erro ao listar anexos da OS.");
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
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const osId = await parseId(context);
    const prefixo = prefixoDaOs(osId);
    const envioDireto = (req.headers.get("content-type") ?? "").includes("application/json");
    const body = envioDireto ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : null;

    try {
      await exigirVagaNaOs(osId);
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
      : await receberFormulario(req, osId);
    if (recebido instanceof NextResponse) return recebido;

    const { arquivo } = recebido;
    const { data: publicData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(arquivo.path);
    const publicUrl = publicData?.publicUrl;
    if (!publicUrl) {
      await supabaseAdmin.storage.from(BUCKET).remove([arquivo.path]);
      return NextResponse.json({ error: "Falha ao gerar URL publica do anexo." }, { status: 500 });
    }

    const { data: saved, error: insertError } = await supabaseAdmin
      .from("osanexo")
      .insert({
        ordemservicoid: osId,
        nome: sanitizeFileName(String(recebido.nome ?? "")),
        tipo: arquivo.tipo,
        tamanho: arquivo.tamanho,
        url: publicUrl,
        path: arquivo.path,
        descricao: String(recebido.descricao ?? "").trim() || null,
        categoria: lerCategoria(recebido.categoria),
      })
      .select("id, ordemservicoid, nome, tipo, tamanho, url, path, descricao, categoria, createdat")
      .single();

    if (insertError) {
      await supabaseAdmin.storage.from(BUCKET).remove([arquivo.path]);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ item: saved }, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/ordens/[id]/anexos", error);
    return respostaDeErro(error, "Erro ao anexar arquivo na OS.");
  }
}
