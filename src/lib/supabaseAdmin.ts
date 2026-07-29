// lib/supabaseAdmin.ts
import { createClient } from "@supabase/supabase-js";
import { getToken } from "next-auth/jwt";
import { headers } from "next/headers";

if (typeof window !== "undefined") {
  throw new Error("supabaseAdmin só pode ser importado no servidor");
}

const urlRaw = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const keyRaw = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// remove aspas acidentais e espaços/nova linha
const url = urlRaw.trim().replace(/^"|"$/g, "");
const serviceKey = keyRaw.trim().replace(/^"|"$/g, "");

if (!url) throw new Error("[supabaseAdmin] NEXT_PUBLIC_SUPABASE_URL ausente em .env.local");
if (!serviceKey) throw new Error("[supabaseAdmin] SUPABASE_SERVICE_ROLE_KEY ausente em .env.local");

try {
  const [, payloadB64] = serviceKey.split(".");
  if (!payloadB64) {
    console.warn("[supabaseAdmin] Chave não parece JWT (sem payload).");
  } else {
    const json = Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const claims = JSON.parse(json);
    if (claims.role !== "service_role") {
      console.warn(`[supabaseAdmin] ALERTA: claim.role = ${claims.role} (esperado: service_role). Você copiou a chave errada?`);
    }
  }
} catch {
  console.warn("[supabaseAdmin] Não foi possível inspecionar o JWT da SERVICE ROLE.");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getAuditUserId(): Promise<string | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;

  try {
    const requestHeaders = await headers();
    const cookie = requestHeaders.get("cookie") ?? "";
    const secureCookie = /(?:^|;\s*)__Secure-authjs\.session-token(?:=|\.)/.test(cookie);
    const token = await getToken({
      req: { headers: requestHeaders },
      secret,
      secureCookie,
    });
    const userId = typeof token?.id === "string" ? token.id.trim() : "";
    return UUID_PATTERN.test(userId) ? userId : null;
  } catch {
    // Jobs, webhooks e chamadas fora de um request autenticado sao do sistema.
    return null;
  }
}

async function fetchWithAuditActor(input: RequestInfo | URL, init?: RequestInit) {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return fetch(input, init);

  const userId = await getAuditUserId();
  if (!userId) return fetch(input, init);

  const requestHeaders = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, name) => requestHeaders.set(name, value));
  requestHeaders.set("x-audit-user-id", userId);
  return fetch(input, { ...init, headers: requestHeaders });
}

export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: fetchWithAuditActor },
});
