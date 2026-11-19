import "server-only";
import { randomUUID } from "node:crypto";
import { db, ImobError } from "./server";
import { StaysClient, StaysError } from "./stays-client";
import { reservationEvents } from "./stays-contract";
import { hojeImobiliario } from "./types";

export type StaysMapping = { id: number; conta: string; imovel_id: number; listing_id: string; listing_codigo: string; listing_titulo: string; canal_id: number };
export async function mappingForProperty(client: StaysClient, imovelId: number) {
  if (!client.config.configured) throw new StaysError("Stays não configurada.", 503);
  const result = await db.from("imovel_stays_vinculo").select("*").eq("conta", client.config.account).eq("imovel_id", imovelId).maybeSingle();
  if (result.error) throw result.error;
  return result.data as StaysMapping | null;
}

export async function syncStaysMapping(client: StaysClient, mapping: StaysMapping, force = true) {
  if (!client.config.configured || client.config.account !== mapping.conta) throw new ImobError(409, "O anúncio pertence a outra conexão Stays.");
  const token = randomUUID();
  const claim = await db.rpc("imob_claim_calendario", { p_id: mapping.canal_id, p_token: token, p_forcar: force });
  if (claim.error) throw claim.error;
  if (!claim.data) throw new ImobError(409, "A atualização deste imóvel já está em andamento. Tente novamente.");
  try {
    const from = hojeImobiliario(), to = new Date(Date.parse(`${from}T12:00:00Z`) + 730 * 86400000).toISOString().slice(0, 10);
    const events = reservationEvents(await client.reservations(mapping.listing_id, from, to), mapping.listing_id);
    const result = await db.rpc("imob_aplicar_calendario", { p_id: mapping.canal_id, p_token: token, p_url: claim.data.calendario_url, p_eventos: events });
    if (result.error) throw new Error("Não foi possível atualizar a disponibilidade com as reservas Stays.");
    return result.data as { eventos: number; conflitos: number };
  } catch (error) {
    const message = error instanceof StaysError ? error.message : "Não foi possível importar as reservas Stays. Os bloqueios anteriores foram preservados.";
    await db.from("imovel_canal_calendario").update({ ultimo_erro: message, sincronizacao_token: null, sincronizacao_ate: null }).eq("id", mapping.canal_id).eq("sincronizacao_token", token);
    throw new StaysError(message);
  }
}

/** Recuperação de notificações após falhas, além da reconciliação periódica das contas vinculadas. */
export async function syncStaysMappings() {
  let client: StaysClient;
  try { client = new StaysClient(); } catch { return { configured: false, updated: 0 }; }
  if (!client.config.configured) return { configured: false, updated: 0 };
  const result = await db.from("imovel_stays_vinculo").select("*").eq("conta", client.config.account).order("id");
  if (result.error) throw result.error;
  // Um cliente inicial: limite explícito, sem confirmar filas ainda não processadas.
  let updated = 0, failed = 0;
  const mappings = result.data as StaysMapping[];
  const cursor = Math.floor(Date.now() / (15 * 60000)) * 2 % Math.max(mappings.length, 1);
  const selected = [...mappings.slice(cursor), ...mappings.slice(0, cursor)].slice(0, 2);
  for (const mapping of selected) {
    const started = new Date().toISOString();
    try {
      await syncStaysMapping(client, mapping, false); updated++;
      const ack = await db.from("stays_webhook_recebimento").update({ processado_em: new Date().toISOString(), erro: null })
        .eq("conta", mapping.conta).eq("listing_id", mapping.listing_id).is("processado_em", null).lte("recebido_em", started);
      if (ack.error) throw ack.error;
    } catch { failed++; }
  }
  return { configured: true, updated, failed, remaining: Math.max(0, mappings.length - selected.length) };
}
