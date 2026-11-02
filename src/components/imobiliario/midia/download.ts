/** Extensão do arquivo pela URL (as fotos da galeria são convertidas para WebP no envio). */
function extensionFrom(url: string, fallback = "webp") {
  const match = url.split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
  return (match?.[1] ?? fallback).toLowerCase();
}

/** "foto-03-sala-de-estar.webp": posição na galeria + nome original, sem acentos nem espaços. */
export function photoFileName(position: number, url: string, originalName?: string) {
  const base = String(originalName ?? "")
    .replace(/\.[^.]+$/, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `foto-${String(position).padStart(2, "0")}${base ? `-${base}` : ""}.${extensionFrom(url)}`;
}

function trigger(href: string, filename: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Baixa como arquivo (sem abrir aba). Lê os bytes para dar o nome do arquivo; se o navegador
 * bloquear a leitura, usa o `?download=` do Storage, que devolve a foto como anexo.
 */
export async function downloadImage(url: string, filename: string) {
  if (url.startsWith("blob:")) return trigger(url, filename);
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    const href = URL.createObjectURL(await response.blob());
    trigger(href, filename);
    window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
  } catch {
    trigger(`${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(filename)}`, filename);
  }
}

/** Uma por vez, com intervalo: o navegador não descarta downloads disparados em rajada. */
export async function downloadAll(
  photos: { url: string; nome?: string }[],
  onProgress?: (done: number, total: number) => void
) {
  let failed = 0;
  for (const [index, photo] of photos.entries()) {
    try {
      await downloadImage(photo.url, photoFileName(index + 1, photo.url, photo.nome));
    } catch {
      failed += 1;
    }
    onProgress?.(index + 1, photos.length);
    await new Promise((resolve) => window.setTimeout(resolve, 350));
  }
  return { total: photos.length, failed };
}
