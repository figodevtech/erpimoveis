import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_BASE_URL = "https://partner.shopeemobile.com";
const STATE_MAX_AGE_MS = 15 * 60 * 1000;

export type ShopeeTokenResponse = {
  access_token: string;
  refresh_token: string;
  expire_in?: number;
  request_id?: string;
  error?: string;
  message?: string;
};

export function getShopeeConfig() {
  const partnerId = Number(process.env.SHOPEE_PARTNER_ID?.trim());
  const partnerKey = process.env.SHOPEE_PARTNER_KEY?.trim();
  const redirectUri = process.env.SHOPEE_REDIRECT_URI?.trim();
  const baseUrl = (process.env.SHOPEE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");

  if (!Number.isInteger(partnerId) || partnerId <= 0) throw new Error("SHOPEE_PARTNER_ID ausente ou inválido.");
  if (!partnerKey) throw new Error("SHOPEE_PARTNER_KEY ausente.");
  if (!redirectUri) throw new Error("SHOPEE_REDIRECT_URI ausente.");
  return { partnerId, partnerKey, redirectUri, baseUrl };
}

export function buildShopeeAuthorizationUrl() {
  const config = getShopeeConfig();
  const path = "/api/v2/shop/auth_partner";
  const timestamp = unixTimestamp();
  const url = new URL(`${config.baseUrl}${path}`);
  url.searchParams.set("partner_id", String(config.partnerId));
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", sign(`${config.partnerId}${path}${timestamp}`, config.partnerKey));
  url.searchParams.set("redirect", config.redirectUri);
  return url.toString();
}

export function encodeShopeeOAuthContext(empresaId: number) {
  const config = getShopeeConfig();
  const encoded = Buffer.from(JSON.stringify({ empresaId, ts: Date.now(), nonce: crypto.randomUUID() }), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded, process.env.SHOPEE_STATE_SECRET?.trim() || config.partnerKey)}`;
}

export function decodeShopeeOAuthContext(value?: string | null) {
  if (!value) return null;
  try {
    const [encoded, received] = value.split(".");
    if (!encoded || !received) return null;
    const config = getShopeeConfig();
    const expected = sign(encoded, process.env.SHOPEE_STATE_SECRET?.trim() || config.partnerKey);
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(received);
    if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { empresaId?: number; ts?: number };
    if (!Number.isInteger(payload.empresaId) || Number(payload.empresaId) <= 0 || !payload.ts) return null;
    if (Date.now() - payload.ts > STATE_MAX_AGE_MS || payload.ts > Date.now() + 60_000) return null;
    return { empresaId: Number(payload.empresaId) };
  } catch {
    return null;
  }
}

export async function exchangeShopeeCode(code: string, shopId: number) {
  return shopeePublicPost<ShopeeTokenResponse>("/api/v2/auth/token/get", {
    code,
    shop_id: shopId,
    partner_id: getShopeeConfig().partnerId,
  });
}

export async function refreshShopeeToken(refreshToken: string, shopId: number) {
  return shopeePublicPost<ShopeeTokenResponse>("/api/v2/auth/access_token/get", {
    refresh_token: refreshToken,
    shop_id: shopId,
    partner_id: getShopeeConfig().partnerId,
  });
}

export async function shopeeShopApi<T>(params: {
  path: string;
  accessToken: string;
  shopId: number;
  method?: "GET" | "POST";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}) {
  const config = getShopeeConfig();
  const timestamp = unixTimestamp();
  const method = params.method ?? "GET";
  const url = new URL(`${config.baseUrl}${params.path}`);
  url.searchParams.set("partner_id", String(config.partnerId));
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("access_token", params.accessToken);
  url.searchParams.set("shop_id", String(params.shopId));
  url.searchParams.set(
    "sign",
    sign(`${config.partnerId}${params.path}${timestamp}${params.accessToken}${params.shopId}`, config.partnerKey),
  );
  for (const [key, value] of Object.entries(params.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method,
    headers: { Accept: "application/json", ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
    body: method === "POST" ? JSON.stringify(params.body ?? {}) : undefined,
    cache: "no-store",
  });
  const text = await response.text();
  const json = parseJson(text);
  if (!response.ok || json?.error) {
    throw new Error(`Shopee ${params.path} falhou (${response.status}): ${json?.message || json?.error || text}`);
  }
  return json as T;
}

export function shopeeTokenExpiresAt(expireIn?: number) {
  const seconds = Number(expireIn);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

async function shopeePublicPost<T>(path: string, body: unknown) {
  const config = getShopeeConfig();
  const timestamp = unixTimestamp();
  const url = new URL(`${config.baseUrl}${path}`);
  url.searchParams.set("partner_id", String(config.partnerId));
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", sign(`${config.partnerId}${path}${timestamp}`, config.partnerKey));
  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await response.text();
  const json = parseJson(text);
  if (!response.ok || json?.error || !json?.access_token) {
    throw new Error(`Shopee ${path} falhou (${response.status}): ${json?.message || json?.error || text}`);
  }
  return json as T;
}

function unixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

function sign(value: string, key: string) {
  return createHmac("sha256", key).update(value).digest("hex");
}

function parseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
