// Utilitários de imagem: EXIF, compressão, concorrência
import { prepareProductImageForUpload } from "@/lib/product-image-upload";

export type CompressOpts = {
  maxWidth?: number;
  maxHeight?: number;
  targetMaxBytes?: number;
  minQuality?: number;
  maxQuality?: number;
};

type Source = { src: CanvasImageSource; w: number; h: number };

async function readExifOrientation(file: File): Promise<number> {
  if (!/jpe?g$/i.test(file.name) && file.type !== "image/jpeg") return 1;
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);
  if (view.getUint16(0, false) !== 0xffd8) return 1;
  let offset = 2;
  const length = view.byteLength;
  while (offset < length) {
    const marker = view.getUint16(offset, false);
    offset += 2;
    if (marker === 0xffe1) {
      const app1Length = view.getUint16(offset, false); offset += 2;
      if (view.getUint32(offset, false) === 0x45786966 && view.getUint16(offset + 4, false) === 0x0000) {
        const tiffOffset = offset + 6;
        const bigEnd = view.getUint16(tiffOffset, false) === 0x4d4d;
        const get16 = (o: number) => view.getUint16(o, bigEnd);
        const get32 = (o: number) => view.getUint32(o, bigEnd);
        if (get16(tiffOffset + 2) !== 0x002a) return 1;
        const ifdOffset = get32(tiffOffset + 4);
        const dirStart = tiffOffset + ifdOffset;
        const entries = get16(dirStart);
        for (let i = 0; i < entries; i++) {
          const entry = dirStart + 2 + i * 12;
          const tag = get16(entry);
          if (tag === 0x0112) {
            const type = get16(entry + 2);
            const num = get32(entry + 4);
            const valOffset = entry + 8;
            if (type === 3 && num === 1) return get16(valOffset);
            return 1;
          }
        }
      }
      offset += app1Length - 2;
    } else if ((marker & 0xff00) !== 0xff00) break;
    else offset += view.getUint16(offset, false);
  }
  return 1;
}

async function loadSource(file: File): Promise<Source> {
  if ("createImageBitmap" in window && typeof createImageBitmap === "function") {
    const bmp = await createImageBitmap(file);
    return { src: bmp, w: (bmp as ImageBitmap).width, h: (bmp as ImageBitmap).height };
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  URL.revokeObjectURL(url);
  return { src: img, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Falha ao gerar blob"))), type, quality);
  });
}

let _supportsWebp: boolean | null = null;
function supportsWebp(): boolean {
  if (_supportsWebp !== null) return _supportsWebp;
  try {
    const c = document.createElement("canvas");
    _supportsWebp = c.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    _supportsWebp = false;
  }
  return _supportsWebp!;
}

function drawWithOrientation(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  orientation: number,
  w: number,
  h: number
) {
  switch (orientation) {
    case 2: ctx.translate(w, 0); ctx.scale(-1, 1); break;
    case 3: ctx.translate(w, h); ctx.rotate(Math.PI); break;
    case 4: ctx.translate(0, h); ctx.scale(1, -1); break;
    case 5: ctx.rotate(0.5 * Math.PI); ctx.scale(1, -1); break;
    case 6: ctx.rotate(0.5 * Math.PI); ctx.translate(0, -h); break;
    case 7: ctx.rotate(0.5 * Math.PI); ctx.translate(w, -h); ctx.scale(-1, 1); break;
    case 8: ctx.rotate(-0.5 * Math.PI); ctx.translate(-w, 0); break;
    default: break;
  }
  ctx.drawImage(source, 0, 0, w, h);
}

export async function compressImage(
  file: File,
  {
    maxWidth = 1600,
    maxHeight = 1600,
    targetMaxBytes = 800 * 1024,
    minQuality = 0.6,
    maxQuality = 0.95,
  }: CompressOpts = {}
): Promise<{ blob: Blob; ext: string; type: "image/webp" | "image/jpeg" }> {
  // Também cobre HEIC/HEIF do iPhone. Sem esta preparação, arquivos pequenos
  // eram enviados crus e os grandes falhavam no createImageBitmap.
  const preparedFile = await prepareProductImageForUpload(file);
  const orientation = await readExifOrientation(preparedFile);

  // Pula compressão se já é pequeno e sem rotação necessária
  if (preparedFile.size <= targetMaxBytes && orientation === 1) {
    const ext = (preparedFile.name.split(".").pop() || "").toLowerCase();
    const normalizedExt = ext === "jpeg" ? "jpg" : ext || "jpg";
    const type = (preparedFile.type as "image/webp" | "image/jpeg") || "image/jpeg";
    return { blob: preparedFile, ext: normalizedExt, type };
  }

  const { src, w: srcW0, h: srcH0 } = await loadSource(preparedFile);
  const swap = orientation >= 5 && orientation <= 8;
  const baseW = swap ? srcH0 : srcW0;
  const baseH = swap ? srcW0 : srcH0;

  let scale = 1;
  if (baseW > maxWidth || baseH > maxHeight) {
    scale = Math.min(maxWidth / baseW, maxHeight / baseH);
  }
  let outW = Math.max(1, Math.round(baseW * scale));
  let outH = Math.max(1, Math.round(baseH * scale));

  const canWebp = supportsWebp();
  let outType: "image/webp" | "image/jpeg" = canWebp ? "image/webp" : "image/jpeg";
  let ext = canWebp ? "webp" : "jpg";

  for (let resizeRound = 0; resizeRound < 3; resizeRound++) {
    let low = minQuality;
    let high = maxQuality;
    let best: Blob | null = null;

    for (let i = 0; i < 6; i++) {
      const q = (low + high) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D não suportado.");
      ctx.save();
      drawWithOrientation(ctx, src, orientation, outW, outH);
      ctx.restore();
      const blob = await canvasToBlob(canvas, outType, q);
      if (blob.size <= targetMaxBytes) {
        best = blob; low = q;
      } else {
        high = q;
      }
    }
    if (best) return { blob: best, ext, type: outType };
    outW = Math.max(1, Math.round(outW * 0.9));
    outH = Math.max(1, Math.round(outH * 0.9));
  }

  // fallback JPEG
  outType = "image/jpeg";
  ext = "jpg";
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D não suportado.");
  ctx.save();
  drawWithOrientation(ctx, src, orientation, outW, outH);
  ctx.restore();
  const blob = await canvasToBlob(canvas, outType, 0.7);
  return { blob, ext, type: outType };
}

/** Concorrência controlada (N tarefas simultâneas) */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;

  async function next(): Promise<void> {
    const idx = i++;
    if (idx >= items.length) return;
    results[idx] = await worker(items[idx], idx);
    return next();
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, next);
  await Promise.all(runners);
  return results;
}
