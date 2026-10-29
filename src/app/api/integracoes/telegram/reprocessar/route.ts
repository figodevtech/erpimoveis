import { NextResponse } from "next/server";
import { requireConfigEdit } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST() {
  try {
    await requireConfigEdit();
    const now = new Date().toISOString();
    const [stockDeliveries, fiscalDeliveries, financeiroDeliveries] = await Promise.all([
      supabaseAdmin.from("telegram_estoque_entrega").update({
        status: "PENDENTE", tentativas: 0, next_retry_at: now, locked_at: null, erro_codigo: null, erro_mensagem: null, updated_at: now,
      }).in("status", ["ERRO", "DESCARTADO"]).not("erro_codigo", "in", '("400","403","INELIGIVEL")').select("id"),
      supabaseAdmin.from("telegram_fiscal_entrega").update({
        status: "PENDENTE", tentativas: 0, next_retry_at: now, locked_at: null, erro_codigo: null, erro_mensagem: null, updated_at: now,
      }).in("status", ["ERRO", "DESCARTADO"]).not("erro_codigo", "in", '("400","403","INELIGIVEL")').select("id"),
      supabaseAdmin.from("telegram_financeiro_entrega").update({
        status: "PENDENTE", tentativas: 0, next_retry_at: now, locked_at: null, erro_codigo: null, erro_mensagem: null, updated_at: now,
      }).in("status", ["ERRO", "DESCARTADO"]).not("erro_codigo", "in", '("400","403","INELIGIVEL")').select("id"),
    ]);
    if (stockDeliveries.error) throw stockDeliveries.error;
    if (fiscalDeliveries.error) throw fiscalDeliveries.error;
    if (financeiroDeliveries.error) throw financeiroDeliveries.error;
    return NextResponse.json({
      ok: true,
      events: 0,
      deliveries: 0,
      stockDeliveries: stockDeliveries.data?.length ?? 0,
      fiscalDeliveries: fiscalDeliveries.data?.length ?? 0,
      financeiroDeliveries: financeiroDeliveries.data?.length ?? 0,
    });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
    return NextResponse.json({ error: statusCode === 500 ? "Não foi possível reprocessar as falhas." : "Sem permissão." }, { status: statusCode });
  }
}
