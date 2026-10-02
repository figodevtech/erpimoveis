import { randomUUID } from "node:crypto";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Envio de anexo em duas etapas, sem o arquivo passar pela função.
 *
 * A Vercel recusa corpo de requisição acima de 4,5 MB antes de a rota rodar,
 * e responde em texto puro: a tela só consegue dizer "não foi possível". Um
 * comprovante em PDF de 6 MB nunca chegava à validação de 10 MB das rotas.
 *
 * 1. A rota valida o pedido (sessão, limite, tipo e tamanho declarados) e
 *    emite uma URL assinada de upload para um caminho que ela mesma escolhe.
 * 2. O navegador sobe o arquivo direto ao Storage e devolve só o caminho.
 *    A rota baixa o objeto, confere o conteúdo de verdade — o declarado na
 *    etapa 1 não vale como prova — e só então registra o anexo.
 */

export class ErroDeAnexo extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

export type ArquivoDeclarado = { nome: string; tipo: string; tamanho: number };
export type ArquivoConsolidado = { path: string; tipo: string; tamanho: number };

const EXTENSAO_POR_TIPO: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const NOME_DO_OBJETO = /^[0-9a-f-]{36}\.[a-z0-9]{1,5}$/;

export function lerArquivoDeclarado(body: unknown): ArquivoDeclarado {
  const dados = (body ?? {}) as Record<string, unknown>;
  const tamanho = Number(dados.tamanho);
  if (!Number.isFinite(tamanho) || tamanho <= 0) {
    throw new ErroDeAnexo("O arquivo está vazio.", 400);
  }
  return {
    nome: String(dados.nome ?? "").trim(),
    tipo: String(dados.tipo ?? "").trim().toLowerCase(),
    tamanho,
  };
}

/** Redimensiona e converte para WebP, como o envio por formulário sempre fez. */
export async function processarImagem(buffer: Buffer) {
  const { default: sharp } = await import("sharp");
  return sharp(buffer)
    .rotate()
    .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
}

export async function emitirEnvioDireto(bucket: string, prefixo: string, arquivo: ArquivoDeclarado) {
  const extensao = EXTENSAO_POR_TIPO[arquivo.tipo] ?? "img";
  const path = `${prefixo}${randomUUID()}.${extensao}`;
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data?.token) {
    throw error ?? new Error("Não foi possível preparar o envio do anexo.");
  }
  return { bucket, path, token: data.token };
}

function caminhoValido(prefixo: string, path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.startsWith(prefixo) &&
    NOME_DO_OBJETO.test(path.slice(prefixo.length))
  );
}

/** Descarta um envio que não vai virar anexo. Caminho fora do prefixo é ignorado. */
export async function descartarEnvioDireto(bucket: string, prefixo: string, path: unknown) {
  if (!caminhoValido(prefixo, path)) return;
  await supabaseAdmin.storage.from(bucket).remove([path]).then(undefined, () => undefined);
}

export async function consolidarEnvioDireto(opcoes: {
  bucket: string;
  prefixo: string;
  path: unknown;
  maxBytes: number;
}): Promise<ArquivoConsolidado> {
  const { bucket, prefixo, path, maxBytes } = opcoes;
  if (!caminhoValido(prefixo, path)) {
    throw new ErroDeAnexo("Caminho do anexo inválido.", 400);
  }

  const storage = supabaseAdmin.storage.from(bucket);
  const { data, error } = await storage.download(path);
  if (error || !data) {
    throw new ErroDeAnexo("O arquivo enviado não foi encontrado. Tente anexar de novo.", 400);
  }

  const original = Buffer.from(await data.arrayBuffer());
  const descartar = () => storage.remove([path]).then(undefined, () => undefined);

  if (original.length === 0) {
    await descartar();
    throw new ErroDeAnexo("O arquivo está vazio.", 400);
  }
  if (original.length > maxBytes) {
    await descartar();
    throw new ErroDeAnexo(`Arquivo muito grande. Máximo: ${maxBytes / 1024 / 1024} MB.`, 413);
  }

  if (path.endsWith(".pdf")) {
    // Alguns geradores escrevem bytes antes do cabeçalho; os leitores aceitam
    // o marcador dentro do primeiro 1 KB.
    if (!original.subarray(0, 1024).includes("%PDF-")) {
      await descartar();
      throw new ErroDeAnexo("O arquivo enviado não é um PDF válido.", 415);
    }
    return { path, tipo: "application/pdf", tamanho: original.length };
  }

  let webp: Buffer;
  try {
    webp = await processarImagem(original);
  } catch {
    await descartar();
    throw new ErroDeAnexo("A imagem enviada é inválida ou está corrompida.", 415);
  }

  const convertido = `${prefixo}${randomUUID()}.webp`;
  const { error: uploadError } = await storage.upload(convertido, webp, {
    contentType: "image/webp",
    upsert: false,
  });
  await descartar();
  if (uploadError) throw uploadError;

  return { path: convertido, tipo: "image/webp", tamanho: webp.length };
}
