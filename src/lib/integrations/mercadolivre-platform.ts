import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

type MercadoLivrePlatformAccount = {
  mlUserId: number;
  nickname?: string | null;
  siteId?: string | null;
};

function platformConfig() {
  const url = process.env.PLATFORM_API_URL?.trim().replace(/\/$/, "");
  const installationId = process.env.PLATFORM_INSTALLATION_ID?.trim();
  const secret = process.env.PLATFORM_API_SECRET?.trim();
  return { url, installationId, secret, configured: Boolean(url && installationId && secret) };
}

export async function registerMercadoLivrePlatformAccount(account: MercadoLivrePlatformAccount) {
  const config = platformConfig();
  if (!config.configured) return { configured: false };
  await platformRequest("/api/v1/mercadolivre/accounts", {
    method: "POST",
    body: {
      ml_user_id: account.mlUserId,
      nickname: account.nickname ?? null,
      site_id: account.siteId || "MLB",
    },
  });
  return { configured: true };
}

export async function unregisterMercadoLivrePlatformAccount() {
  const config = platformConfig();
  if (!config.configured) return { configured: false };
  await platformRequest("/api/v1/mercadolivre/accounts", { method: "DELETE" });
  return { configured: true };
}

export function verifyMercadoLivrePlatformDelivery(input: {
  body: string;
  timestamp: string | null;
  signature: string | null;
  installationId: string | null;
}) {
  const config = platformConfig();
  if (!config.configured || !input.timestamp || !input.signature || !input.installationId) return false;
  if (input.installationId !== config.installationId) return false;
  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60_000) return false;

  const secretHash = createHash("sha256").update(config.secret!).digest("hex");
  const expected = Buffer.from(
    createHmac("sha256", secretHash).update(`${input.timestamp}.${input.body}`).digest("hex"),
    "utf8",
  );
  const received = Buffer.from(input.signature, "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function platformRequest(path: string, options: { method: "POST" | "DELETE"; body?: unknown }) {
  const config = platformConfig();
  if (!config.configured) throw new Error("Credenciais da Figo Central ausentes.");
  const response = await fetch(`${config.url}${path}`, {
    method: options.method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.secret}`,
      "X-Installation-Id": config.installationId!,
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || `Figo Central respondeu HTTP ${response.status}.`);
  return payload;
}
