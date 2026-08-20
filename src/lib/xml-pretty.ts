/**
 * Indenta um XML para leitura na tela. Roda no navegador — depende de DOMParser
 * e XMLSerializer.
 *
 * Lança quando o texto não é XML válido: quem chama decide se mostra o bruto
 * mesmo assim. Para o XML de uma nota já emitida, o bruto é sempre melhor do
 * que nada.
 */
export function formatXml(raw: string): string {
  const parser = new DOMParser();
  const dom = parser.parseFromString(raw, "application/xml");
  if (dom.getElementsByTagName("parsererror").length) {
    throw new Error("XML invalido para formatar.");
  }

  const serialized = new XMLSerializer().serializeToString(dom);
  const PADDING = "  ";
  const xmlString = serialized.replace(/(>)(<)(\/*)/g, "$1\n$2$3");
  let pad = 0;

  return xmlString
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.match(/^<\/.+>/)) pad = Math.max(pad - 1, 0);
      const indent = PADDING.repeat(pad);
      if (trimmed.match(/^<[^!?][^>]*[^/]>$/) && !trimmed.startsWith("</")) {
        pad += 1;
      }
      return indent + trimmed;
    })
    .join("\n");
}

/** Tira quebras e espaços entre tags — o formato que vai para transmissão. */
export function compactarXml(raw: string): string {
  return raw.replace(/[\r\n\t]/g, "").replace(/>\s+</g, "><").trim();
}
