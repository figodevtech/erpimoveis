import { isAxiosError } from "axios";

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_REQUEST_BYTES = 3 * 1024 * 1024;
const MAX_EDGE = 1600;
const QUALITY_STEPS = [0.82, 0.7, 0.6, 0.5, 0.4];
const RESIZE_STEPS = [1, 0.75, 0.55, 0.4];

type EncodableType = "image/webp" | "image/jpeg";

function isHeicFile(file: File) {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

let webpEncoderSupport: boolean | null = null;

/**
 * Codificar WebP em canvas não é universal (Safari antigo, WebViews de fábrica).
 * Nesses navegadores o `toBlob` ignora o tipo pedido e devolve PNG.
 */
export function supportsWebpEncoding(): boolean {
  if (webpEncoderSupport !== null) return webpEncoderSupport;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    webpEncoderSupport = canvas.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    webpEncoderSupport = false;
  }
  return webpEncoderSupport;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch {
      resolve(null);
    }
  });
}

/** Codifica confirmando o formato de saída: se o navegador devolveu outra coisa
 * (PNG, tipicamente), reencoda em JPEG em vez de aceitar um arquivo enorme. */
async function encodeCanvas(
  canvas: HTMLCanvasElement,
  preferred: EncodableType,
  quality: number,
): Promise<{ blob: Blob; type: EncodableType } | null> {
  const blob = await canvasToBlob(canvas, preferred, quality);
  if (blob && blob.type === preferred) return { blob, type: preferred };
  if (preferred === "image/jpeg") return blob ? { blob, type: "image/jpeg" } : null;

  const jpeg = await canvasToBlob(canvas, "image/jpeg", quality);
  if (jpeg) return { blob: jpeg, type: "image/jpeg" };
  return null;
}

function drawToCanvas(bitmap: ImageBitmap, scale: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível preparar a imagem para envio.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Mantém cada request abaixo do limite usual de proxies/serverless. O backend
 * ainda normaliza para WebP em 1200px; esta etapa evita que a foto original de
 * celular seja recusada antes de alcançar a API.
 */
export async function prepareProductImageForUpload(file: File): Promise<File> {
  const heic = isHeicFile(file);
  if (!file.type.startsWith("image/") && !heic) {
    throw new Error(`${file.name}: o arquivo selecionado não é uma imagem.`);
  }
  if (file.size <= 0) throw new Error(`${file.name}: o arquivo está vazio.`);
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error(`${file.name}: a imagem excede o limite de 25 MB.`);
  }
  if (!heic && file.size <= MAX_REQUEST_BYTES) return file;

  let bitmap: ImageBitmap;
  if (heic) {
    try {
      // O Sharp disponível em ambientes serverless frequentemente não inclui
      // libheif. Decodificar no cliente transforma a foto do iPhone antes que
      // ela atravesse o proxy e torna o backend independente desse codec.
      const { heicTo } = await import("heic-to/csp");
      bitmap = await heicTo({ blob: file, type: "bitmap" });
    } catch (error) {
      console.error("Falha ao converter HEIC:", error);
      throw new Error(`${file.name}: não foi possível converter a foto HEIC do iPhone.`);
    }
  } else {
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      throw new Error(`${file.name}: formato não suportado pelo navegador. Use JPEG, PNG ou WebP.`);
    }
  }

  try {
    const baseScale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    let preferred: EncodableType = supportsWebpEncoding() ? "image/webp" : "image/jpeg";
    let smallest: { blob: Blob; type: EncodableType } | null = null;

    // Reduz qualidade e, se ainda não couber, também as dimensões. Antes eram
    // só duas tentativas de WebP na mesma resolução: quando o navegador não
    // codificava WebP, as duas devolviam o mesmo PNG e o envio falhava.
    for (const resize of RESIZE_STEPS) {
      const canvas = drawToCanvas(bitmap, baseScale * resize);
      for (const quality of QUALITY_STEPS) {
        const encoded = await encodeCanvas(canvas, preferred, quality);
        if (!encoded) continue;
        preferred = encoded.type;
        if (encoded.blob.size <= MAX_REQUEST_BYTES) return toUploadFile(file, encoded);
        if (!smallest || encoded.blob.size < smallest.blob.size) smallest = encoded;
      }
    }

    if (!smallest) throw new Error(`${file.name}: não foi possível compactar a imagem.`);
    throw new Error(`${file.name}: não foi possível reduzir a imagem para o tamanho permitido.`);
  } finally {
    bitmap.close?.();
  }
}

function toUploadFile(source: File, encoded: { blob: Blob; type: EncodableType }) {
  const baseName = source.name.replace(/\.[^.]+$/, "") || "produto";
  const ext = encoded.type === "image/webp" ? "webp" : "jpg";
  return new File([encoded.blob], `${baseName}.${ext}`, {
    type: encoded.type,
    lastModified: source.lastModified,
  });
}

export function productImageUploadError(error: unknown, fileName?: string): string {
  const prefix = fileName ? `${fileName}: ` : "";
  if (isAxiosError(error)) {
    if (error.response?.status === 413) return `${prefix}imagem muito grande para envio.`;
    const apiMessage = String(error.response?.data?.error ?? "").trim();
    if (apiMessage) return `${prefix}${apiMessage}`;
    if (!error.response) return `${prefix}falha de conexão durante o envio.`;
  }
  const message = error instanceof Error ? error.message : "Falha ao enviar a imagem.";
  return message.startsWith(prefix) ? message : `${prefix}${message}`;
}
