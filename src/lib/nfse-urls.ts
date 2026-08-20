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
 * A Focus diferencia o espelho HTML (`url`), o documento PDF (`url_danfse`) e o
 * XML da nota (`caminho_xml_nota_fiscal`). Os três são coisas distintas e não
 * podem compartilhar o mesmo campo local.
 *
 * O XML vem como caminho relativo à API da Focus — só existe depois que a nota
 * autoriza, porque é o documento que a prefeitura devolveu.
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
  const xmlUrl = firstText(data.caminho_xml_nota_fiscal, data.url_xml, data.caminho_xml);

  return {
    consultationUrl: absoluteUrl(consultationUrl, baseUrl),
    pdfUrl: absoluteUrl(pdfUrl, baseUrl),
    xmlUrl: absoluteUrl(xmlUrl, baseUrl),
  };
}
