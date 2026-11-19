import { z } from "zod";
import { bodyOf, db, identifier, imobFailure, internal, ImobError, json } from "@/lib/imobiliario/server";
import { staysConfig, staysId } from "@/lib/imobiliario/stays-contract";
import { StaysClient, StaysError } from "@/lib/imobiliario/stays-client";
import { mappingForProperty, syncStaysMapping } from "@/lib/imobiliario/stays-sync";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
const failure = (error: unknown) => error instanceof StaysError ? json({ error: error.message }, error.status) : imobFailure(error);
async function property(context: Context) {
  const id = identifier((await context.params).id);
  const result = await db.from("imovel").select("id").eq("id", id).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new ImobError(404, "Imóvel não encontrado.");
  return id;
}
export async function GET(request: Request, context: Context) {
  try {
    await internal("imoveis:visualizar");
    const id = await property(context);
    let config;
    try { config = staysConfig(); } catch { return json({ configured: false, invalidConfig: true, missing: [], mapping: null, listings: [] }); }
    if (!config.configured) return json({ configured: false, missing: config.missing, mapping: null, listings: [] });
    const client = new StaysClient();
    const mapping = await mappingForProperty(client, id);
    let state = null;
    if (mapping) {
      const result = await db.from("imovel_canal_calendario").select("ultima_sincronizacao,ultimo_erro,eventos_ativos,conflitos").eq("id", mapping.canal_id).single();
      if (result.error) throw result.error;
      state = result.data;
    }
    let listings: Awaited<ReturnType<StaysClient["listings"]>> = [];
    if (new URL(request.url).searchParams.get("listar") === "true") {
      await internal("imoveis:editar");
      listings = await client.listings();
    }
    return json({ configured: true, host: config.origin, webhookReady: Boolean(config.publicKey), mapping, state, listings, mode: "IMPORTACAO" });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    await internal("imoveis:editar");
    const id = await property(context), client = new StaysClient();
    const input = z.object({ action: z.enum(["vincular", "sincronizar"]), listingId: staysId.optional() }).parse(await bodyOf(request));
    if (input.action === "vincular") {
      if (!input.listingId) throw new ImobError(400, "Selecione o anúncio Stays.");
      const listing = await client.listing(input.listingId);
      if (listing.status !== "active") throw new ImobError(409, "Selecione um anúncio ativo na Stays.");
      if (!client.config.configured) throw new StaysError("Stays não configurada.", 503);
      const linked = await db.rpc("imob_vincular_stays", { p_conta: client.config.account, p_imovel_id: id, p_listing_id: listing.id,
        p_codigo: listing.code, p_titulo: listing.title, p_url: `${client.config.origin}/external/v1/booking/reservations` });
      if (linked.error) throw linked.error;
    }
    const mapping = await mappingForProperty(client, id);
    if (!mapping) throw new ImobError(404, "Vincule um anúncio Stays a este imóvel primeiro.");
    const result = await syncStaysMapping(client, mapping);
    return json({ ok: true, ...result });
  } catch (error) { return failure(error); }
}
export async function DELETE(_request: Request, context: Context) {
  try {
    await internal("imoveis:editar");
    const id = await property(context), client = new StaysClient();
    const mapping = await mappingForProperty(client, id);
    if (mapping) {
      const result = await db.from("imovel_canal_calendario").delete().eq("id", mapping.canal_id).eq("imovel_id", id).eq("canal", "STAYS");
      if (result.error) throw result.error;
    }
    return json({ ok: true });
  } catch (error) { return failure(error); }
}
