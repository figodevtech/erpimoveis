type NfseUrlPayload = Record<string, unknown>;

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return null;
}

function absoluteUrl(value: string | null, baseUrl?: string) {
  if (!value || !baseUrl) return value;

  try {
    return new URL(value, `${baseUrl.replace(/\/$/, "")}/`).toString();
  } catch {
    return value;
  }
}

/**
 * A Focus diferencia o espelho HTML (`url`) do documento PDF
 * (`url_danfse`). Eles não podem compartilhar o mesmo campo local.
 */
export function extractNfseUrls(payload: unknown, baseUrl?: string) {
  const data = payload && typeof payload === "object" ? payload as NfseUrlPayload : {};
  const consultationUrl = firstText(data.url_consulta, data.url);
  const pdfUrl = firstText(
    data.url_danfse,
    data.url_pdf,
    data.caminho_danfse,
    data.caminho_danfe,
  );

  return {
    consultationUrl: absoluteUrl(consultationUrl, baseUrl),
    pdfUrl: absoluteUrl(pdfUrl, baseUrl),
  };
}
