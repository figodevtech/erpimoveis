import { isAxiosError } from "axios";

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_REQUEST_BYTES = 3 * 1024 * 1024;
const MAX_EDGE = 1600;

function isHeicFile(file: File) {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Não foi possível compactar a imagem.")),
      type,
      quality,
    );
  });
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
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível preparar a imagem para envio.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    let blob = await canvasToBlob(canvas, "image/webp", 0.82);
    if (blob.size > MAX_REQUEST_BYTES) blob = await canvasToBlob(canvas, "image/webp", 0.68);
    if (blob.size > MAX_REQUEST_BYTES) {
      throw new Error(`${file.name}: não foi possível reduzir a imagem para o tamanho permitido.`);
    }

    const baseName = file.name.replace(/\.[^.]+$/, "") || "produto";
    return new File([blob], `${baseName}.webp`, {
      type: "image/webp",
      lastModified: file.lastModified,
    });
  } finally {
    bitmap.close();
  }
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
