import { createHash, timingSafeEqual, verify } from "node:crypto";
import { z } from "zod";

export const staysId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, "Identificador Stays inválido.");
const civil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const date = new Date(`${v}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v;
}, "Data inválida retornada pela Stays.");

export function staysConfig(env: Record<string, string | undefined> = process.env) {
  const missing = ["STAYS_BASE_URL", "STAYS_CLIENT_ID", "STAYS_CLIENT_SECRET"].filter((name) => !env[name]?.trim());
  if (missing.length) return { configured: false as const, missing };
  const url = new URL(env.STAYS_BASE_URL!);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.port && url.port !== "443") ||
    url.pathname !== "/" || !/^[a-z0-9-]+\.stays\.(net|com\.br)$/.test(url.hostname)) throw new Error("STAYS_BASE_URL deve ser o endereço HTTPS do sistema, como https://cliente.stays.net.");
  return { configured: true as const, missing: [], origin: url.origin,
    account: createHash("sha256").update(url.origin).digest("hex"),
    clientId: env.STAYS_CLIENT_ID!.trim(), clientSecret: env.STAYS_CLIENT_SECRET!.trim(),
    publicKey: env.STAYS_WEBHOOK_PUBLIC_KEY?.replace(/\\n/g, "\n"),
  };
}

export const staysListingSchema = z.object({ _id: staysId, id: z.string(), internalName: z.string().optional(),
  _mstitle: z.record(z.string(), z.string()).optional(), status: z.enum(["active", "inactive", "hidden", "draft"]) }).passthrough();
export function listingSummary(value: unknown) {
  const listing = staysListingSchema.parse(value);
  return { id: listing._id, code: listing.id, title: listing.internalName || listing._mstitle?.pt_BR || listing._mstitle?.en_US || listing.id, status: listing.status };
}

export function reservationEvents(value: unknown, listingId: string) {
  const rows = z.array(z.object({ _id: staysId, _idlisting: staysId, type: z.enum(["reserved", "booked", "contract", "blocked", "maintenance", "canceled"]),
    checkInDate: civil, checkOutDate: civil }).passthrough()).parse(value);
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    if (row._idlisting !== listingId || row.checkOutDate <= row.checkInDate || seen.has(row._id)) throw new Error("A Stays retornou reservas inconsistentes. Os bloqueios anteriores foram preservados.");
    seen.add(row._id);
    return row.type === "canceled" ? [] : [{ uid: `stays:${row._id}`, inicio: row.checkInDate, fim: row.checkOutDate }];
  });
}

export const staysNotification = z.object({ action: z.string().max(100), _dt: z.string().datetime({ offset: true }),
  payload: z.object({ _id: staysId.optional(), _idlisting: staysId.optional() }).passthrough() });

/** A Stays assina JSON.stringify({action,_dt,payload}), não os bytes brutos do HTTP. */
export function authenticateStaysWebhook(value: unknown, clientId: string | null, signature: string | null,
  config: { clientId: string; publicKey?: string }) {
  if (!config.publicKey || !clientId || !signature || signature.length > 4096) return null;
  const digest = (v: string) => createHash("sha256").update(v).digest();
  if (!timingSafeEqual(digest(clientId), digest(config.clientId))) return null;
  // Validar sem reconstruir o payload: a ordem de suas chaves participa da assinatura.
  if (!staysNotification.safeParse(value).success) return null;
  const raw = value as { action: string; _dt: string; payload: Record<string, unknown> };
  const canonical = JSON.stringify({ action: raw.action, _dt: raw._dt, payload: raw.payload });
  try {
    if (!verify("SHA256", Buffer.from(canonical), config.publicKey, Buffer.from(signature, "base64"))) return null;
  } catch { return null; }
  return { ...raw, receipt: createHash("sha256").update(canonical).digest("hex") };
}
