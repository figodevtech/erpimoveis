const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function extractMercadoLivreYoutubeId(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";

  const storedId = text.match(/^([A-Za-z0-9_-]{11});youtube$/i)?.[1];
  if (storedId) return storedId;
  if (YOUTUBE_ID_PATTERN.test(text)) return text;

  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    let candidate = "";
    if (hostname === "youtu.be") candidate = url.pathname.split("/").filter(Boolean)[0] ?? "";
    if (hostname === "youtube.com" || hostname === "m.youtube.com") {
      candidate =
        url.searchParams.get("v") ??
        url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/)?.[1] ??
        "";
    }
    return YOUTUBE_ID_PATTERN.test(candidate) ? candidate : "";
  } catch {
    return "";
  }
}

export function normalizeMercadoLivreVideoId(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const id = extractMercadoLivreYoutubeId(text);
  if (!id) {
    const error = new Error("Informe uma URL válida do YouTube ou o código de 11 caracteres do vídeo.");
    (error as any).status = 422;
    (error as any).fieldErrors = { videoUrl: error.message };
    throw error;
  }
  return `${id};youtube`;
}

export function mercadoLivreVideoInput(value: unknown) {
  const id = extractMercadoLivreYoutubeId(value);
  return id ? `https://youtu.be/${id}` : "";
}
