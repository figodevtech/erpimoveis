// Consulta simples ao HTML público do Mercado Livre, sem OAuth, browser automatizado ou proxy.
// O site pode negar acesso ou alterar o layout a qualquer momento.
export type MercadoLivreSiteItem = {
  id: string;
  title: string;
  price: number;
  permalink: string;
};

export class MercadoLivreSiteSearchError extends Error {
  constructor(
    message: string,
    readonly status: number = 502,
  ) {
    super(message);
    this.name = "MercadoLivreSiteSearchError";
  }
}

const MAX_HTML_SIZE = 4_000_000;
const SITE_BASE = "https://lista.mercadolivre.com.br";

function decodeEntities(value: string): string {
  return value
    .replace(/&(?:amp|quot|apos|lt|gt|nbsp);/gi, (entity) => {
      const replacements: Record<string, string> = {
        "&amp;": "&", "&quot;": "\"", "&apos;": "'", "&lt;": "<",
        "&gt;": ">", "&nbsp;": " ",
      };
      return replacements[entity.toLowerCase()] ?? entity;
    })
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, number: string) => {
      const code = number.toLowerCase().startsWith("x")
        ? Number.parseInt(number.slice(1), 16)
        : Number.parseInt(number, 10);
      return Number.isSafeInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    });
}

function readableText(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim();
}

function normalizePermalink(href: string): string | null {
  try {
    const url = new URL(decodeEntities(href), "https://www.mercadolivre.com.br");
    const hostname = url.hostname.toLowerCase();
    if (hostname !== "mercadolivre.com.br" && !hostname.endsWith(".mercadolivre.com.br")) return null;
    if (url.pathname === "/" || url.pathname.startsWith("/jm/search")) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function cardTitle(fragment: string): string | null {
  const match = fragment.match(
    /<(?:a|h2|h3)\b[^>]*class\s*=\s*["'][^"']*(?:poly-component__title|ui-search-item__title)[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|h2|h3)>/i,
  );
  const title = match ? readableText(match[1]) : "";
  return title.length >= 3 ? title : null;
}

function cardUrl(fragment: string): string | null {
  const matches = Array.from(fragment.matchAll(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>/gi));
  const titleLink = matches.find((match) => /poly-component__title|ui-search-item__title/i.test(match[0]));
  for (const match of titleLink ? [titleLink, ...matches] : matches) {
    const link = normalizePermalink(match[2]);
    if (link) return link;
  }
  return null;
}

function cardPrice(fragment: string): number | null {
  // Prefere o bloco de preço vigente para não capturar o preço anterior riscado.
  const marker = fragment.search(/poly-price__current|ui-search-price__second-line|price__current/i);
  const current = marker >= 0 ? fragment.slice(marker, marker + 8_000) : fragment;
  const fraction = /<span\b[^>]*class\s*=\s*["'][^"']*andes-money-amount__fraction[^"']*["'][^>]*>\s*([\d.,\s]+)\s*<\/span>/i.exec(current);
  if (!fraction) return null;
  const integer = Number(fraction[1].replace(/[^\d]/g, ""));
  if (!Number.isSafeInteger(integer) || integer <= 0) return null;
  const trailing = current.slice((fraction.index ?? 0) + fraction[0].length, (fraction.index ?? 0) + fraction[0].length + 400);
  const cents = /<span\b[^>]*class\s*=\s*["'][^"']*andes-money-amount__cents[^"']*["'][^>]*>\s*(\d{1,2})\s*<\/span>/i.exec(trailing);
  const result = integer + (cents ? Number(cents[1]) / (cents[1].length === 1 ? 10 : 100) : 0);
  return result > 0 && result <= 10_000_000 ? Math.round(result * 100) / 100 : null;
}

function itemFromFragment(fragment: string): MercadoLivreSiteItem | null {
  const title = cardTitle(fragment);
  const permalink = cardUrl(fragment);
  const price = cardPrice(fragment);
  if (!title || !permalink || price === null) return null;
  const match = permalink.match(/MLB[-/]?(\d+)/i);
  return { id: match ? "MLB" + match[1] : permalink, title, price, permalink };
}

function parseCards(html: string, pattern: RegExp, limit: number): MercadoLivreSiteItem[] {
  const matches = Array.from(html.matchAll(pattern));
  const seen = new Set<string>();
  const items: MercadoLivreSiteItem[] = [];
  for (let i = 0; i < matches.length && items.length < limit; i += 1) {
    const fragment = html.slice(matches[i].index, matches[i + 1]?.index ?? html.length).slice(0, 40_000);
    const item = itemFromFragment(fragment);
    if (!item || seen.has(item.permalink)) continue;
    seen.add(item.permalink);
    items.push(item);
  }
  return items;
}

function jsonLdItems(html: string, limit: number): MercadoLivreSiteItem[] {
  const items: MercadoLivreSiteItem[] = [];
  const seen = new Set<string>();
  const scripts = html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  const add = (raw: any) => {
    if (!raw || typeof raw !== "object") return;
    const product = raw.item && typeof raw.item === "object" ? raw.item : raw;
    const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
    const title = typeof product.name === "string" ? readableText(product.name) : "";
    const permalink = normalizePermalink(product.url || raw.url || offer?.url || "");
    const price = Number(offer?.price ?? product.price);
    if (!title || !permalink || !Number.isFinite(price) || price <= 0 || seen.has(permalink)) return;
    seen.add(permalink);
    const idMatch = permalink.match(/MLB[-/]?(\d+)/i);
    items.push({ id: idMatch ? "MLB" + idMatch[1] : permalink, title, price: Math.round(price * 100) / 100, permalink });
  };
  for (const script of scripts) {
    try {
      const root = JSON.parse(script[1]);
      const roots = Array.isArray(root) ? root : [root];
      for (const node of roots) {
        const nodes = Array.isArray(node?.["@graph"]) ? node["@graph"] : [node];
        for (const entry of nodes) {
          if (Array.isArray(entry?.itemListElement)) {
            for (const item of entry.itemListElement) add(item);
          }
        }
      }
    } catch {
      // Ignora scripts não JSON ou incompletos.
    }
    if (items.length >= limit) break;
  }
  return items.slice(0, limit);
}

export function parseMercadoLivreSearchHtml(html: string, limit = 5): MercadoLivreSiteItem[] {
  const safeLimit = Math.max(1, Math.min(5, Math.floor(limit)));
  // Layout antigo e layout poly-card são analisados separadamente para não duplicar cards aninhados.
  const listItems = parseCards(
    html,
    /<li\b[^>]*class\s*=\s*["'][^"']*(?:ui-search-layout__item|poly-card__list-item)[^"']*["'][^>]*>/gi,
    safeLimit,
  );
  if (listItems.length) return listItems;
  const polyCards = parseCards(
    html,
    /<div\b[^>]*class\s*=\s*["'][^"']*poly-card(?:\s|--)[^"']*["'][^>]*>/gi,
    safeLimit,
  );
  return polyCards.length ? polyCards : jsonLdItems(html, safeLimit);
}

export function mercadoLivreSearchUrl(title: string): string {
  const slug = title.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return SITE_BASE + "/" + encodeURIComponent(slug);
}

export async function searchMercadoLivreSite(title: string): Promise<{
  data: MercadoLivreSiteItem[];
  averagePrice: number;
  searchUrl: string;
}> {
  const searchUrl = mercadoLivreSearchUrl(title);
  let response: Response;
  try {
    response = await fetch(searchUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9",
        "User-Agent": "Mozilla/5.0 (compatible; ERPOFICINA/1.0; busca de precos)",
      },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new MercadoLivreSiteSearchError("Não foi possível acessar a busca pública do Mercado Livre.");
  }
  if (response.status === 403 || response.status === 429) {
    throw new MercadoLivreSiteSearchError("O Mercado Livre bloqueou ou limitou a pesquisa automática.", 503);
  }
  if (!response.ok) {
    throw new MercadoLivreSiteSearchError("Busca pública do Mercado Livre indisponível (HTTP " + response.status + ").");
  }
  const size = Number(response.headers.get("content-length"));
  if (size > MAX_HTML_SIZE) {
    throw new MercadoLivreSiteSearchError("Resposta do site excedeu o tamanho permitido.");
  }
  const html = (await response.text()).slice(0, MAX_HTML_SIZE);
  const data = parseMercadoLivreSearchHtml(html, 5);
  if (!data.length) {
    const blocked = /captcha|recaptcha|verifique que você é humano|verify you are human|access denied|acesso negado/i.test(html);
    throw new MercadoLivreSiteSearchError(
      blocked ? "O Mercado Livre apresentou um bloqueio de acesso." : "Nenhum preço pôde ser extraído da página de resultados.",
      blocked ? 503 : 502,
    );
  }
  const averagePrice = Math.round((data.reduce((sum, item) => sum + item.price, 0) / data.length) * 100) / 100;
  return { data, averagePrice, searchUrl };
}
