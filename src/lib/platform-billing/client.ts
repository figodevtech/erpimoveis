import "server-only";

import { z } from "zod";
import type { PlatformBillingResult, PlatformSubscription } from "./types";

const chargeSchema = z.object({
  id: z.string().uuid(), competence: z.string(), due_date: z.string(), amount_cents: z.number(),
  charge_type: z.enum(["MONTHLY", "EXTRA"]), description: z.string(),
  status: z.enum(["PENDING", "PAID", "OVERDUE", "CANCELED", "REFUNDED", "ERROR"]),
  paid_at: z.string().nullable(), received_amount_cents: z.number().nullable().default(null),
  gateway: z.string(), checkout_url: z.string().nullable(), bank_slip_url: z.string().nullable(),
  identification_field: z.string().nullable(), pix_copy_paste: z.string().nullable(),
});

const subscriptionSchema = z.object({
  videos: z.object({ enabled: z.boolean(), capacityBytes: z.number(), usedBytes: z.number(), reservedBytes: z.number(), monthlyAmountCents: z.number(), scheduled: z.object({ competence: z.string(), amount_cents: z.number() }).nullable() }).optional(),
  company: z.object({ name: z.string().nullable(), billingEmail: z.string().nullable() }),
  subscription: z.object({
    status: z.enum(["ACTIVE", "PAST_DUE", "BLOCKED", "CANCELED"]),
    monthlyAmountCents: z.number(), billingDay: z.number(), paidThrough: z.string().nullable(), gateway: z.string(),
  }),
  access: z.object({
    allowed: z.boolean(), showBanner: z.boolean(), lateDays: z.number(), blockAt: z.string().nullable(), message: z.string().nullable(),
  }),
  charges: z.array(chargeSchema),
  synchronizedAt: z.string(),
});

type CacheEntry = { value: PlatformSubscription; fetchedAt: number };
const globalCache = globalThis as typeof globalThis & { __platformBillingCache?: CacheEntry };
const FRESH_MS = 60_000;
const STALE_MS = 24 * 60 * 60 * 1000;

export function platformConfiguration() {
  const url = process.env.PLATFORM_API_URL?.trim().replace(/\/$/, "");
  const installationId = process.env.PLATFORM_INSTALLATION_ID?.trim();
  const secret = process.env.PLATFORM_API_SECRET?.trim();
  return { url, installationId, secret, configured: Boolean(url && installationId && secret) };
}

export async function getPlatformSubscription(force = false): Promise<PlatformBillingResult> {
  const config = platformConfiguration();
  if (!config.configured) return { configured: false, stale: false, data: null, error: "Integração financeira não configurada." };

  const cached = globalCache.__platformBillingCache;
  if (!force && cached && Date.now() - cached.fetchedAt < FRESH_MS) {
    return { configured: true, stale: false, data: cached.value };
  }

  try {
    const response = await fetch(`${config.url}/api/v1/subscription`, {
      cache: "no-store",
      headers: { "X-Installation-Id": config.installationId!, Authorization: `Bearer ${config.secret}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Central respondeu ${response.status}.`);
    const data = subscriptionSchema.parse(await response.json());
    globalCache.__platformBillingCache = { value: data, fetchedAt: Date.now() };
    return { configured: true, stale: false, data };
  } catch (cause) {
    if (cached && Date.now() - cached.fetchedAt < STALE_MS) {
      return { configured: true, stale: true, data: cached.value, error: "Exibindo a última situação disponível." };
    }
    return { configured: true, stale: true, data: null, error: cause instanceof Error ? cause.message : "Central indisponível." };
  }
}
