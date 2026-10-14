// Texto rico dos campos de descrição: HTML pequeno, gerado pelo editor
// (Tiptap), só com parágrafo, quebra, negrito, itálico, sublinhado, riscado e
// listas. Sem "use client": as rotas usam o limite e a conversão.
//
// O campo continua aceitando o texto puro gravado antes do editor: quem lê usa
// `pareceHtml` para decidir entre renderizar o HTML (sempre higienizado) ou o
// texto com as quebras de linha.

export const TAGS_TEXTO_RICO = ["p", "br", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li"] as const;

/** Limite do HTML gravado; folga para as tags sobre ~5 mil caracteres de texto. */
export const LIMITE_HTML_TEXTO_RICO = 20_000;

const TAG_CONHECIDA = new RegExp(`<\\/?(?:${TAGS_TEXTO_RICO.join("|")})\\b[^>]*>`, "i");

export function pareceHtml(valor: string | null | undefined): boolean {
  return TAG_CONHECIDA.test(String(valor ?? ""));
}

function escaparHtml(texto: string) {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Texto puro (gravado antes do editor) em parágrafos, uma linha por parágrafo. */
export function textoParaHtml(texto: string | null | undefined): string {
  const valor = String(texto ?? "");
  if (!valor.trim()) return "";
  return valor
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((linha) => `<p>${escaparHtml(linha)}</p>`)
    .join("");
}

/** O valor no formato do editor: HTML como está, texto puro convertido. */
export function paraHtmlDoEditor(valor: string | null | undefined): string {
  return pareceHtml(valor) ? String(valor) : textoParaHtml(valor);
}

/** Texto sem marcação, para contar caracteres e saber se o campo está vazio. */
export function textoPlanoDoHtml(html: string | null | undefined): string {
  return String(html ?? "")
    .replace(/<\/(p|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .trim();
}
