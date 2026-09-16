import { randomUUID } from "node:crypto";
import { persistRotatedToken } from "./mercadolivre-token-save";
import { canReuseMercadoLivreToken, type TokenSnapshot } from "./mercadolivre-token-policy";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { refreshMercadoLivreToken, mercadoLivreTokenMetadata, tokenExpiresAt } from "./mercadolivre";

/** O lease no banco protege também entre processos e deployments. */
const inFlight = new Map<number, Promise<string>>();

export async function ensureMercadoLivreToken(account: number | TokenSnapshot, rejectedToken?: string): Promise<string> {
  if (typeof account !== "number" && canReuseMercadoLivreToken(account, rejectedToken)) return account.access_token;
  const accountId = typeof account === "number" ? account : Number(account.id);
  if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Error("Conta Mercado Livre inválida.");
  const pending = inFlight.get(accountId);
  if (pending) return pending;
  const task = renew(accountId, rejectedToken);
  inFlight.set(accountId, task);
  try { return await task; } finally { if (inFlight.get(accountId) === task) inFlight.delete(accountId); }
}

async function renew(accountId: number, rejectedToken?: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: account, error } = await supabaseAdmin.from("mercadolivre_account")
      .select("id, access_token, refresh_token, expires_at").eq("id", accountId).single();
    if (error) throw error;
    const expires = Date.parse(account.expires_at ?? "");
    if (account.access_token && ((rejectedToken && account.access_token !== rejectedToken) ||
      (!rejectedToken && Number.isFinite(expires) && expires > Date.now() + 300_000))) return account.access_token;
    if (!account.refresh_token) throw new Error("Conta Mercado Livre sem token de renovação. Reconecte a conta.");
    const lease = randomUUID();
    const { data: reserved, error: lockError } = await supabaseAdmin.from("mercadolivre_account")
      .update({ refresh_lock_id: lease, refresh_lock_until: new Date(Date.now() + 90_000).toISOString() })
      .eq("id", accountId).eq("refresh_token", account.refresh_token)
      .or(`refresh_lock_until.is.null,refresh_lock_until.lt.${new Date().toISOString()}`)
      .select("id").maybeSingle();
    if (lockError) throw new Error("Não foi possível reservar a renovação Mercado Livre. Confira a migration de refresh OAuth.");
    if (!reserved) {
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 750 * (attempt + 1)));
      continue;
    }
    // Em falha/timeout mantemos o lease até expirar: não repetir imediatamente um token de uso único.
    const token = await refreshMercadoLivreToken(account.refresh_token);
    const tokenUpdate = {
      access_token: token.access_token, refresh_token: token.refresh_token ?? account.refresh_token,
      expires_at: tokenExpiresAt(token.expires_in), token_type: token.token_type ?? null,
      scope: token.scope ?? null, raw_token: mercadoLivreTokenMetadata(token),
      refresh_lock_id: null, refresh_lock_until: null, updated_at: new Date().toISOString(),
    };
    await persistRotatedToken(async () => {
      const { data: saved, error: saveError } = await supabaseAdmin.from("mercadolivre_account")
        .update(tokenUpdate).eq("id", accountId).eq("refresh_lock_id", lease)
        .eq("refresh_token", account.refresh_token).select("id").maybeSingle();
      if (saveError) throw saveError;
      return saved ? "saved" : "conflict";
    }, async () => {
      const { data: current, error: readError } = await supabaseAdmin.from("mercadolivre_account")
        .select("access_token, refresh_token").eq("id", accountId).single();
      if (readError) throw readError;
      return current.access_token === tokenUpdate.access_token && current.refresh_token === tokenUpdate.refresh_token;
    });
    return token.access_token;
  }
  throw new Error("Renovação Mercado Livre em andamento. Tente novamente em alguns segundos.");
}
