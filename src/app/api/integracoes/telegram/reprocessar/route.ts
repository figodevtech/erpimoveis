import { NextResponse } from "next/server";
import { requireConfigEdit } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST() {
  try {
    await requireConfigEdit();
    const now = new Date().toISOString();
    const [events, deliveries] = await Promise.all([
      supabaseAdmin.from("os_notificacao_evento").update({
        status_processamento: "PENDENTE", tentativas: 0, disponivel_em: now, locked_at: null, ultimo_erro: null,
      }).eq("status_processamento", "ERRO").select("id"),
      supabaseAdmin.from("os_notificacao_entrega").update({
        status: "PENDENTE", tentativas: 0, next_retry_at: now, locked_at: null, erro_codigo: null, erro_mensagem: null, updated_at: now,
      }).in("status", ["ERRO", "DESCARTADO"]).not("erro_codigo", "in", '("400","403")').select("id"),
    ]);
    if (events.error) throw events.error;
    if (deliveries.error) throw deliveries.error;
    return NextResponse.json({ ok: true, events: events.data?.length ?? 0, deliveries: deliveries.data?.length ?? 0 });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
    return NextResponse.json({ error: statusCode === 500 ? "Não foi possível reprocessar as falhas." : "Sem permissão." }, { status: statusCode });
  }
}
