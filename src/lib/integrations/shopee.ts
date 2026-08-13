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
    throw new Error(payload?.error || `Figo Central respondeu ${response.status}.`);
  }
  return payload;
}
