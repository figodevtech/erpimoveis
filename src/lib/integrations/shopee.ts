import "server-only";

type GatewayConfiguration = {
  configured: boolean;
  missing: string[];
};

export type ShopeeGatewayAccount = {
  shop_id: number;
  shop_name: string | null;
  region: string;
  expires_at: string | null;
  status: string;
};

export type ShopeeGatewayConnection = GatewayConfiguration & {
  connected: boolean;
  account: ShopeeGatewayAccount | null;
};

export function getShopeeGatewayConfig() {
  const url = process.env.PLATFORM_API_URL?.trim().replace(/\/$/, "");
  const installationId = process.env.PLATFORM_INSTALLATION_ID?.trim();
  const secret = process.env.PLATFORM_API_SECRET?.trim();
  const missing = [
    !url ? "PLATFORM_API_URL" : null,
    !installationId ? "PLATFORM_INSTALLATION_ID" : null,
    !secret ? "PLATFORM_API_SECRET" : null,
  ].filter((value): value is string => Boolean(value));
  return { url, installationId, secret, configured: missing.length === 0, missing };
}

export async function createShopeeAuthorization(returnUrl: string) {
  return shopeeGatewayRequest<{ authorization_url: string; expires_at: string }>("/api/v1/shopee/authorizations", {
    method: "POST",
    body: { return_url: returnUrl },
  });
}

export function getShopeeGatewayConnection() {
  return shopeeGatewayRequest<ShopeeGatewayConnection>("/api/v1/shopee/connection");
}

export async function getShopeeLanguage() {
  try {
    const connection = await getShopeeGatewayConnection();
    const region = String(connection.account?.region || "").toUpperCase();
    return ({ BR: "pt-BR", TH: "th", VN: "vi", ID: "id", MY: "ms", TW: "zh-Hant", PL: "pl", MX: "es-MX", CO: "es-CO", CL: "es-CL" } as Record<string, string>)[region] || "en";
  } catch {
    return "en";
  }
}

export function disconnectShopeeGateway() {
  return shopeeGatewayRequest<{ disconnected: boolean }>("/api/v1/shopee/connection", { method: "DELETE" });
}

export function shopeeShopApi<T>(params: {
  path: string;
  method?: "GET" | "POST";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}) {
  return shopeeGatewayRequest<T>("/api/v1/shopee/proxy", {
    method: "POST",
    body: {
      path: params.path,
      method: params.method ?? "GET",
      query: params.query ?? {},
      body: params.body,
    },
  });
}

export async function getShopeeCategoryAttributes(categoryId: number, language = "en") {
  let treeError: unknown;
  try {
    const tree = await shopeeShopApi<any>({
      path: "/api/v2/product/get_attribute_tree",
      query: { category_id_list: String(categoryId), language },
    });
    const categoryTree = (tree?.response?.list ?? []).find((item: any) => Number(item?.category_id) === Number(categoryId));
    if (categoryTree?.warning) throw new Error(String(categoryTree.warning));
    if (Array.isArray(categoryTree?.attribute_tree)) return categoryTree.attribute_tree;
    throw new Error("A Shopee não retornou os atributos desta categoria.");
  } catch (error) {
    treeError = error;
  }

  try {
    const legacy = await shopeeShopApi<any>({
      path: "/api/v2/product/get_attributes",
      query: { category_id: categoryId, language },
    });
    return legacy?.response?.attribute_list ?? [];
  } catch {
    throw treeError;
  }
}

export async function uploadShopeeImageFromUrl(imageUrl: string) {
  const url = new URL(imageUrl);
  if (url.protocol !== "https:") throw new Error("A Shopee exige uma imagem pública HTTPS.");
  if (isPrivateImageHost(url.hostname)) throw new Error("Endereço de imagem privado não permitido.");

  const imageResponse = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!imageResponse.ok) {
    if (imageResponse.status === 404) {
      throw new Error("A imagem do produto não foi encontrada no endereço cadastrado. Substitua ou envie novamente a imagem.");
    }
    if (imageResponse.status === 401 || imageResponse.status === 403) {
      throw new Error("A imagem do produto não está acessível publicamente. Use uma URL HTTPS que abra sem login.");
    }
    throw new Error(`O servidor da imagem recusou o download (status ${imageResponse.status}). Tente outra imagem.`);
  }
  const mimeType = String(imageResponse.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    throw new Error("Formato de imagem não suportado. Use JPG, PNG ou WebP.");
  }
  const bytes = new Uint8Array(await imageResponse.arrayBuffer());
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error("A imagem deve ter no máximo 8 MB.");
  const result = await shopeeGatewayRequest<any>("/api/v1/shopee/media", {
    method: "POST",
    body: {
      data: Buffer.from(bytes).toString("base64"),
      mimeType,
      fileName: decodeURIComponent(url.pathname.split("/").pop() || "produto.jpg").slice(0, 120),
    },
  });
  const imageId = result?.response?.image_info?.image_id || result?.response?.image_id || result?.image_id;
  if (!imageId) throw new Error("A Shopee não retornou o identificador da imagem.");
  return String(imageId);
}

async function shopeeGatewayRequest<T>(path: string, options?: { method?: "GET" | "POST" | "DELETE"; body?: unknown }) {
  const config = getShopeeGatewayConfig();
  if (!config.configured) throw new Error(`Integração com a Figo Central incompleta: ${config.missing.join(", ")}.`);
  const response = await fetch(`${config.url}${path}`, {
    method: options?.method ?? "GET",
    headers: {
      Accept: "application/json",
      "X-Installation-Id": config.installationId!,
      Authorization: `Bearer ${config.secret}`,
      ...(options?.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !payload) {
    if (response.status === 404 && path === "/api/v1/shopee/media") {
      throw new Error("O serviço de envio de imagens da Figo Central ainda não está publicado. Atualize o deploy da Central antes de publicar anúncios.");
    }
    throw new Error(payload?.error || `Figo Central respondeu ${response.status}.`);
  }
  return payload;
}

function isPrivateImageHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || host.endsWith(".local")) return true;
  return /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}
