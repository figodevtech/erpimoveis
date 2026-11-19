import { staysConfig, authenticateStaysWebhook } from "@/lib/imobiliario/stays-contract";
import { StaysClient } from "@/lib/imobiliario/stays-client";
import { syncStaysMapping, type StaysMapping } from "@/lib/imobiliario/stays-sync";
import { db, json } from "@/lib/imobiliario/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  let config;
  try { config = staysConfig(); } catch { return json({ succeed: false }, 503); }
  if (!config.configured || !config.publicKey) return json({ succeed: false }, 503);
  if (Number(request.headers.get("content-length")) > 200000) return json({ succeed: false }, 413);
  let raw;
  try { const body = await request.text(); if (body.length > 200000) return json({ succeed: false }, 413); raw = JSON.parse(body); }
  catch { return json({ succeed: false }, 400); }
  const event = authenticateStaysWebhook(raw, request.headers.get("x-stays-client-id"), request.headers.get("x-stays-signature"), config);
  if (!event) return json({ succeed: false }, 401);
  if (!["reservation.created", "reservation.modified", "reservation.canceled", "reservation.deleted", "reservation.reactivated"].includes(event.action)) return json({ succeed: true });
  const listingId = typeof event.payload._idlisting === "string" ? event.payload._idlisting : null;
  if (!listingId) return json({ succeed: false }, 400);
  try {
    const inserted = await db.from("stays_webhook_recebimento").upsert({ conta: config.account, recibo: event.receipt, acao: event.action, listing_id: listingId }, { onConflict: "conta,recibo", ignoreDuplicates: true });
    if (inserted.error) throw inserted.error;
    const receipt = await db.from("stays_webhook_recebimento").select("processado_em").eq("conta", config.account).eq("recibo", event.receipt).single();
    if (receipt.error) throw receipt.error;
    if (receipt.data.processado_em) return json({ succeed: true });
    const linked = await db.from("imovel_stays_vinculo").select("*").eq("conta", config.account).eq("listing_id", listingId).maybeSingle();
    if (linked.error) throw linked.error;
    if (linked.data) await syncStaysMapping(new StaysClient(), linked.data as StaysMapping);
    const done = await db.from("stays_webhook_recebimento").update({ processado_em: new Date().toISOString(), erro: null }).eq("conta", config.account).eq("recibo", event.receipt);
    if (done.error) throw done.error;
    return json({ succeed: true });
  } catch {
    await db.from("stays_webhook_recebimento").update({ erro: "Falha ao atualizar disponibilidade. Aguardando nova tentativa." }).eq("conta", config.account).eq("recibo", event.receipt);
    return json({ succeed: false }, 503); // Não confirma antes de reconciliar; a Stays poderá reenviar.
  }
}
