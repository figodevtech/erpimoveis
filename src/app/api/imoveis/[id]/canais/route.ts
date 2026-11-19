import { db, bodyOf, identifier, imobFailure, internal, ImobError, json } from "@/lib/imobiliario/server";
import { channelConfigSchema } from "@/lib/imobiliario/channel-config";
import { syncCalendar } from "@/lib/imobiliario/calendar-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };

async function propertyId(context: Context) {
  const id = identifier((await context.params).id);
  const result = await db.from("imovel").select("id").eq("id", id).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new ImobError(404, "Imóvel não encontrado.");
  return id;
}

export async function GET(_request: Request, context: Context) {
  try {
    await internal("imoveis:visualizar");
    const id = await propertyId(context);
    const result = await db.from("imovel_canal_calendario").select("id,imovel_id,canal,anuncio,responsavel,calendario_url,exportacao_confirmada,ultima_tentativa,ultima_sincronizacao,ultimo_erro,eventos_ativos,conflitos").eq("imovel_id", id).order("id");
    if (result.error?.code === "42P01" || result.error?.code === "PGRST205") {
      return json({ items: [], migrationPending: true, accountConnectionAvailable: false });
    }
    if (result.error) throw result.error;
    // A conexão por conta depende de um provedor oficial; calendários não são anúncios importados.
    return json({ items: result.data, migrationPending: false, accountConnectionAvailable: false });
  } catch (error) { return imobFailure(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    await internal("imoveis:editar");
    const id = await propertyId(context);
    const input = channelConfigSchema.parse({ ...await bodyOf(request), imovel_id: id });
    const result = await db.from("imovel_canal_calendario")
      .upsert({ ...input, updated_at: new Date().toISOString(), ultima_tentativa: null, sincronizacao_token: null, sincronizacao_ate: null }, { onConflict: "imovel_id,canal" }).select("id").single();
    if (result.error) throw result.error;
    const sync = await syncCalendar(result.data.id, true);
    return json({ ok: true, sync });
  } catch (error) { return imobFailure(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    await internal("imoveis:editar");
    const imovelId = await propertyId(context);
    const id = identifier((await bodyOf(request)).id);
    const result = await db.from("imovel_canal_calendario").delete().eq("id", id).eq("imovel_id", imovelId);
    if (result.error) throw result.error;
    return json({ ok: true });
  } catch (error) { return imobFailure(error); }
}
