import { createHmac, timingSafeEqual } from "crypto";

const ML_AUTH_BASE_URL = "https://auth.mercadolivre.com.br/authorization";
const ML_API_BASE_URL = "https://api.mercadolibre.com";
const OAUTH_STATE_MAX_AGE_MS = 15 * 60 * 1000;

type MercadoLivreTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  user_id?: number;
  refresh_token?: string;
};

export function mercadoLivreTokenMetadata(token: MercadoLivreTokenResponse) {
  return {
    token_type: token.token_type ?? null,
    expires_in: token.expires_in ?? null,
    scope: token.scope ?? null,
    user_id: token.user_id ?? null,
  };
}

export type MercadoLivreUser = {
  id: number;
  nickname?: string;
  site_id?: string;
  [key: string]: unknown;
};

export type MercadoLivreOrderItem = {
  item?: {
    id?: string;
    title?: string;
    variation_id?: number | null;
  };
  quantity?: number;
  unit_price?: number;
  full_unit_price?: number;
  sale_fee?: number;
};

export type MercadoLivreOrder = {
  id: number;
  status?: string;
  date_created?: string;
  total_amount?: number;
  paid_amount?: number;
  currency_id?: string;
  buyer?: {
    id?: number;
    nickname?: string;
    first_name?: string;
    last_name?: string;
  };
  order_items?: MercadoLivreOrderItem[];
  shipping?: {
    id?: number;
  };
  payments?: Array<Record<string, unknown>>;
  tags?: string[];
  status_detail?: string;
  date_closed?: string;
  cancel_detail?: {
    group?: string;
    code?: string;
    description?: string;
    requested_by?: string;
    date?: string;
  } | null;
  feedback?: {
    sale?: number | string | Record<string, unknown> | null;
    purchase?: number | string | Record<string, unknown> | null;
  } | null;
  feedback_detail?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export function getMercadoLivreConfig() {
  const clientId = process.env.MERCADOLIVRE_CLIENT_ID?.trim();
  const clientSecret = process.env.MERCADOLIVRE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.MERCADOLIVRE_REDIRECT_URI?.trim();
  const siteId = process.env.MERCADOLIVRE_SITE_ID?.trim() || "MLB";

  if (!clientId) throw new Error("MERCADOLIVRE_CLIENT_ID ausente.");
  if (!clientSecret) throw new Error("MERCADOLIVRE_CLIENT_SECRET ausente.");
  if (!redirectUri) throw new Error("MERCADOLIVRE_REDIRECT_URI ausente.");

  return { clientId, clientSecret, redirectUri, siteId };
}

export function encodeMercadoLivreState(payload: Record<string, unknown>) {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${signMercadoLivreState(encodedPayload)}`;
}

export function decodeMercadoLivreState(state: string | null) {
  if (!state) return null;

  try {
    const [encodedPayload, receivedSignature] = state.split(".");
    if (!encodedPayload || !receivedSignature) return null;

    const expectedSignature = signMercadoLivreState(encodedPayload);
    const receivedBuffer = Buffer.from(receivedSignature, "utf8");
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");
    if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) return null;

    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
      empresaId?: number;
      ts?: number;
      nonce?: string;
    };
    if (!payload.ts || Date.now() - payload.ts > OAUTH_STATE_MAX_AGE_MS || payload.ts > Date.now() + 60_000) return null;
    if (!payload.nonce || !Number.isInteger(payload.empresaId) || Number(payload.empresaId) <= 0) return null;
    return payload;
  } catch {
    return null;
  }
}

function signMercadoLivreState(payload: string) {
  const config = getMercadoLivreConfig();
  const secret = process.env.MERCADOLIVRE_STATE_SECRET?.trim() || process.env.AUTH_SECRET?.trim() || config.clientSecret;
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function buildMercadoLivreAuthorizationUrl(params: { empresaId?: number }) {
  const config = getMercadoLivreConfig();
  const state = encodeMercadoLivreState({
    empresaId: params.empresaId,
    ts: Date.now(),
    nonce: crypto.randomUUID(),
  });

  const url = new URL(ML_AUTH_BASE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", "offline_access");
  url.searchParams.set("state", state);

  return url.toString();
}

export async function exchangeMercadoLivreCode(code: string) {
  const config = getMercadoLivreConfig();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
  });

  return requestMercadoLivreToken(body);
}

export async function refreshMercadoLivreToken(refreshToken: string) {
  const config = getMercadoLivreConfig();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
  });

  return requestMercadoLivreToken(body);
}

export async function getMercadoLivreMe(accessToken: string) {
  const response = await fetch(`${ML_API_BASE_URL}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mercado Livre /users/me falhou (${response.status}): ${text}`);
  }

  return (await response.json()) as MercadoLivreUser;
}

export async function getMercadoLivreOrder(accessToken: string, orderId: number | string) {
  return mercadoLivreApiGet<MercadoLivreOrder>(accessToken, `/orders/${orderId}`);
}

export async function searchMercadoLivreOrders(
  accessToken: string,
  params: {
    sellerId: number;
    offset?: number;
    limit?: number;
    orderDateFrom?: string;
    orderDateLastUpdatedFrom?: string;
    orderDateLastUpdatedTo?: string;
  },
) {
  const searchParams = new URLSearchParams({
    seller: String(params.sellerId),
    offset: String(params.offset ?? 0),
    limit: String(params.limit ?? 50),
    sort: "date_desc",
  });

  if (params.orderDateFrom) {
    searchParams.set("order.date_created.from", params.orderDateFrom);
  }
  if (params.orderDateLastUpdatedFrom) {
    searchParams.set("order.date_last_updated.from", params.orderDateLastUpdatedFrom);
  }
  if (params.orderDateLastUpdatedTo) {
    searchParams.set("order.date_last_updated.to", params.orderDateLastUpdatedTo);
  }

  return mercadoLivreApiGet<{
    query: string;
    results: MercadoLivreOrder[];
    paging?: { total?: number; offset?: number; limit?: number };
  }>(accessToken, `/orders/search?${searchParams.toString()}`);
}

export async function mercadoLivreApiGet<T>(accessToken: string, path: string, extraHeaders?: HeadersInit) {
  const response = await fetch(`${ML_API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, ...extraHeaders },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mercado Livre ${path} falhou (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

export async function mercadoLivreApiPut<T>(accessToken: string, path: string, body: unknown) {
  const response = await fetch(`${ML_API_BASE_URL}${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mercado Livre ${path} falhou (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

export async function mercadoLivreApiPost<T>(accessToken: string, path: string, body: unknown, extraHeaders?: HeadersInit) {
  const response = await fetch(`${ML_API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mercado Livre ${path} falhou (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

export async function mercadoLivreApiDelete<T>(accessToken: string, path: string, body?: unknown) {
  const response = await fetch(`${ML_API_BASE_URL}${path}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mercado Livre ${path} falhou (${response.status}): ${text}`);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function tokenExpiresAt(expiresIn?: number) {
  if (!expiresIn || Number.isNaN(expiresIn)) return null;
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

async function requestMercadoLivreToken(body: URLSearchParams) {
  const response = await fetch(`${ML_API_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mercado Livre oauth/token falhou (${response.status}): ${text}`);
  }

  return (await response.json()) as MercadoLivreTokenResponse;
}
