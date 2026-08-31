import sharp, { type Metadata } from "sharp";

const MAX_EDGE = 1600;
const MAX_OUTPUT_BYTES = 1_800_000;
const MIN_EDGE = 100;

export type ShopeePreparedImage = {
  bytes: Uint8Array;
  mimeType: "image/jpeg";
  fileName: string;
  width: number;
  height: number;
};

/** A Shopee aceita JPG/JPEG/PNG, enquanto as imagens do ERP são armazenadas
 * em WebP. É necessário decodificar e reencodar; trocar só o MIME não basta. */
export async function prepareShopeeImage(source: Uint8Array, originalFileName?: string): Promise<ShopeePreparedImage> {
  if (!source.length) throw new Error("A imagem está vazia.");

  let metadata: Metadata;
  try {
    metadata = await sharp(source, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
  } catch {
    throw new Error("O arquivo recebido não contém uma imagem válida.");
  }

  const sourceWidth = Number(metadata.autoOrient?.width ?? metadata.width ?? 0);
  const sourceHeight = Number(metadata.autoOrient?.height ?? metadata.height ?? 0);
  if (!sourceWidth || !sourceHeight) throw new Error("Não foi possível identificar as dimensões da imagem.");
  if (Math.min(sourceWidth, sourceHeight) < MIN_EDGE) {
    throw new Error(`A imagem é muito pequena (${sourceWidth}x${sourceHeight}px). Use pelo menos ${MIN_EDGE}x${MIN_EDGE}px.`);
  }

  for (const edge of [MAX_EDGE, 1400, 1200, 1000, 800]) {
    for (const quality of [86, 78, 70, 62]) {
      const output = await sharp(source, { failOn: "error", limitInputPixels: 40_000_000 })
        .rotate()
        .flatten({ background: "#ffffff" })
        .toColourspace("srgb")
        .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality, progressive: true, mozjpeg: true })
        .toBuffer();
      if (output.length <= MAX_OUTPUT_BYTES) {
        const preparedMetadata = await sharp(output).metadata();
        return {
          bytes: new Uint8Array(output),
          mimeType: "image/jpeg",
          fileName: jpegFileName(originalFileName),
          width: Number(preparedMetadata.width ?? sourceWidth),
          height: Number(preparedMetadata.height ?? sourceHeight),
        };
      }
    }
  }

  throw new Error("Não foi possível reduzir a imagem para o limite aceito pela Shopee.");
}

function jpegFileName(originalFileName?: string) {
  const base = String(originalFileName || "produto").replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "produto";
  return `${base}.jpg`;
}
