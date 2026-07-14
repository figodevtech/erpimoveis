import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;

type UploadedPicture = {
  id: string;
};

export async function uploadMercadoLivrePictures(accessToken: string, sources: string[]) {
  const uploaded: UploadedPicture[] = [];
  for (const [index, source] of sources.entries()) {
    try {
      const image = await downloadPublicImage(source);
      const formData = new FormData();
      formData.append("file", new Blob([image.bytes], { type: image.contentType }), `imagem-${index + 1}.${extensionFor(image.contentType)}`);

      const response = await fetch("https://api.mercadolibre.com/pictures/items/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
        cache: "no-store",
      });
      const text = await response.text();
      let result: any = {};
      try {
        result = text ? JSON.parse(text) : {};
      } catch {
        result = { message: text };
      }

      if (!response.ok || !result?.id) {
        throw new Error(result?.message || result?.error || `Upload recusado com status ${response.status}.`);
      }
      uploaded.push({ id: String(result.id) });
    } catch (error: any) {
      throw pictureError(`Imagem ${index + 1}: ${error?.message || "não foi possível enviá-la ao Mercado Livre."}`, source);
    }
  }
  return uploaded;
}

async function downloadPublicImage(source: string) {
  let currentUrl = new URL(source);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicHost(currentUrl);
    const response = await fetch(currentUrl, {
      method: "GET",
      headers: { Accept: "image/jpeg,image/png,image/webp,image/gif" },
      redirect: "manual",
      cache: "no-store",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) throw new Error("a URL possui redirecionamento inválido ou excessivo.");
      currentUrl = new URL(location, currentUrl);
      continue;
    }
    if (!response.ok) throw new Error(`a URL pública respondeu com status ${response.status}.`);

    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (!SUPPORTED_IMAGE_TYPES.has(contentType)) throw new Error(`formato ${contentType || "não informado"} não é uma imagem compatível.`);

    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_IMAGE_BYTES) throw new Error("o arquivo excede o limite de 10 MB.");
    const bytes = await readWithLimit(response, MAX_IMAGE_BYTES);
    if (!bytes.byteLength) throw new Error("o arquivo está vazio.");
    return { bytes, contentType };
  }
  throw new Error("não foi possível acessar a imagem.");
}

const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

async function readWithLimit(response: Response, limit: number) {
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("o arquivo excede o limite de 10 MB.");
    }
    chunks.push(value);
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function assertPublicHost(url: URL) {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("use uma URL HTTP ou HTTPS.");
  if (url.username || url.password) throw new Error("URLs com credenciais não são permitidas.");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) throw new Error("a imagem precisa estar disponível publicamente.");

  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("a imagem precisa estar hospedada em um endereço público.");
  }
}

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  const ipv4 = normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
  const parts = ipv4.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

function extensionFor(contentType: string) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  return "jpg";
}

function pictureError(message: string, source: string) {
  const error = new Error(message);
  (error as any).status = 422;
  (error as any).fieldErrors = { images: message };
  (error as any).validation = { source };
  return error;
}
