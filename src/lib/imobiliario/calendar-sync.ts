import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./server";
import { channelConfigSchema } from "./channel-config";
import { parseOccupancyCalendar } from "./ical-import";

export async function downloadCalendar(url: string, canal: "AIRBNB" | "BOOKING", fetcher: typeof fetch = fetch) {
  const checked = channelConfigSchema.safeParse({ imovel_id: 1, canal, calendario_url: url });
  if (!checked.success) throw new Error("Link de calendário inválido. Copie novamente o link de exportação do canal.");
  // Somente hosts oficiais, sem redirects: nenhum token pode ser encaminhado a outro destino.
  const response = await fetcher(checked.data.calendario_url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000), headers: { Accept: "text/calendar" } });
  if (!response.ok || !response.body) throw new Error("O canal não disponibilizou o calendário. Confira o link e tente novamente.");
  if (Number(response.headers.get("content-length")) > 2_000_000) throw new Error("Calendário maior que o limite permitido.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2_000_000) throw new Error("Calendário maior que o limite permitido.");
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); }
  return parseOccupancyCalendar(body);
}

export async function syncCalendar(id: number, force = false) {
  const token = randomUUID();
  const claimed = await db.rpc("imob_claim_calendario", { p_id: id, p_token: token, p_forcar: force });
  if (claimed.error) throw claimed.error;
  if (!claimed.data) return { id, status: "AGUARDANDO" as const };
  const config = claimed.data;
  let events;
  try { events = await downloadCalendar(config.calendario_url, config.canal); }
  catch (error) {
    // Erros de fetch podem conter o endereço secreto; somente mensagens controladas chegam ao banco/UI.
    const safeMessage = error instanceof TypeError || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))
      ? "Não foi possível acessar o canal. As datas anteriores foram preservadas."
      : error instanceof Error ? error.message : "Falha ao ler o calendário. As datas anteriores foram preservadas.";
    const result = await db.from("imovel_canal_calendario").update({ ultimo_erro: safeMessage, sincronizacao_token: null, sincronizacao_ate: null })
      .eq("id", id).eq("sincronizacao_token", token);
    if (result.error) throw result.error;
    return { id, canal: config.canal, status: "ERRO" as const, erro: safeMessage };
  }
  const result = await db.rpc("imob_aplicar_calendario", { p_id: id, p_token: token, p_url: config.calendario_url, p_eventos: events });
  if (result.error) {
    const message = "Não foi possível aplicar o calendário. As datas anteriores foram preservadas. Tente atualizar novamente.";
    await db.from("imovel_canal_calendario").update({ ultimo_erro: message, sincronizacao_token: null, sincronizacao_ate: null }).eq("id", id).eq("sincronizacao_token", token);
    return { id, canal: config.canal, status: "ERRO" as const, erro: message };
  }
  return { id, canal: config.canal, status: "OK" as const, ...result.data };
}

export async function syncCalendars(imovelId?: number) {
  let query = db.from("imovel_canal_calendario").select("id").order("ultima_tentativa", { ascending: true, nullsFirst: true }).order("id").limit(10);
  if (imovelId) query = query.eq("imovel_id", imovelId);
  else query = query.or(`ultima_tentativa.is.null,ultima_tentativa.lt.${new Date(Date.now() - 15 * 60000).toISOString()}`);
  const result = await query;
  if (result.error) throw result.error;
  const results = [];
  for (const config of result.data) {
    try { results.push(await syncCalendar(config.id, Boolean(imovelId))); }
    catch { results.push({ id: config.id, status: "ERRO" as const, erro: "Falha ao acessar a configuração do calendário." }); }
  }
  return results;
}
