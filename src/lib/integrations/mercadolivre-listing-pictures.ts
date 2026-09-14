export const MIN_MERCADO_LIVRE_LISTING_PICTURES = 3;

export type MercadoLivrePictureRequirement = {
  urls: string[];
  count: number;
  missing: number;
  valid: boolean;
};

/**
 * Aceita somente URLs públicas HTTP(S) e elimina repetições equivalentes.
 * O valor normalizado é usado igualmente pela UI e pelas APIs de anúncio.
 */
export function parseMercadoLivrePictureUrls(value: string) {
  const urls = new Map<string, string>();

  for (const source of String(value ?? "").split(/\r?\n/)) {
    const trimmed = source.trim();
    if (!trimmed) continue;

    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
      urls.set(parsed.href, parsed.href);
    } catch {
      // Entradas inválidas não contam para o mínimo exigido.
    }
  }

  return Array.from(urls.values());
}

export function getMercadoLivrePictureRequirement(value: string): MercadoLivrePictureRequirement {
  const urls = parseMercadoLivrePictureUrls(value);
  return buildPictureRequirement(urls.length, urls);
}

/** Conta fotos já persistidas retornadas pela API do Mercado Livre. */
export function countDistinctMercadoLivrePictures(pictures: unknown) {
  if (!Array.isArray(pictures)) return 0;
  const keys = new Set<string>();

  for (const picture of pictures) {
    if (typeof picture === "string") {
      const key = picture.trim();
      if (key) keys.add(key);
      continue;
    }
    if (!picture || typeof picture !== "object") continue;
    const value = picture as Record<string, unknown>;
    const key = String(value.id ?? value.secure_url ?? value.url ?? value.source ?? "").trim();
    if (key) keys.add(key);
  }

  return keys.size;
}

export function getMercadoLivreEditPictureRequirement(params: {
  currentPictures: unknown;
  pictureUrlProvided: boolean;
  pictureUrl?: unknown;
}) {
  if (params.pictureUrlProvided) {
    return getMercadoLivrePictureRequirement(String(params.pictureUrl ?? ""));
  }
  return buildPictureRequirement(countDistinctMercadoLivrePictures(params.currentPictures), []);
}

export function mercadoLivrePictureRequirementMessage(count: number) {
  const missing = Math.max(MIN_MERCADO_LIVRE_LISTING_PICTURES - count, 0);
  if (missing === 0) return "Quantidade mínima de fotos atendida.";
  return `Adicione mais ${missing} ${missing === 1 ? "foto pública válida e distinta" : "fotos públicas válidas e distintas"}. O anúncio exige pelo menos ${MIN_MERCADO_LIVRE_LISTING_PICTURES} fotos.`;
}

function buildPictureRequirement(count: number, urls: string[]): MercadoLivrePictureRequirement {
  const missing = Math.max(MIN_MERCADO_LIVRE_LISTING_PICTURES - count, 0);
  return { urls, count, missing, valid: missing === 0 };
}
