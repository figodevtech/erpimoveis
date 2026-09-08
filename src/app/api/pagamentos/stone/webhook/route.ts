// src/app/api/pagamentos/stone/webhook/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { identificadoresStone, statusDoEventoStone } from "@/lib/payments/stone-webhook";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    const tipoEvento = payload.type as string;
    const dados = payload.data;

    if (!tipoEvento || !dados) {
      return NextResponse.json(
        { ok: false, erro: "Payload inválido" },
        { status: 400 }
      );
    }

    console.log("Webhook recebido:", tipoEvento, dados?.id);

    const codigosPagarme = identificadoresStone(dados);

    if (!codigosPagarme.length) {
      return NextResponse.json(
        { ok: false, erro: "Sem identificador da transação" },
        { status: 400 }
      );
    }

    // Localiza pagamento pelo provider_tx_id
    const { data: pagamentos, error: buscaError } = await supabaseAdmin
      .from("pagamento")
      .select("*")
      .in("provider_tx_id", codigosPagarme)
      .limit(2);
    if (buscaError) throw buscaError;
    if ((pagamentos?.length ?? 0) > 1) throw new Error("Identificadores Stone vinculados a mais de um pagamento.");

    const pagamento = pagamentos?.[0];
    if (!pagamento) {
      console.warn("Pagamento não encontrado para webhook:", codigosPagarme);
      await supabaseAdmin.from("pagamento_evento").insert({
        tipo: "WEBHOOK_DESCONHECIDO",
        payload,
      });
      return NextResponse.json({ ok: true });
    }

    // Define novo status
    const novoStatus = statusDoEventoStone(tipoEvento);
    if (!novoStatus) return NextResponse.json({ ok: true });

    if (pagamento.ordemservicoid) {
      const { error } = await supabaseAdmin.rpc("confirmar_pagamento_stone_os", {
        p_pagamento_id: pagamento.id, p_status: novoStatus,
        p_evento: tipoEvento.toUpperCase(), p_payload: payload, p_registrar_receita: false,
      });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    // Atualiza pagamento
    await supabaseAdmin
      .from("pagamento")
      .update({
        status: novoStatus,
        atualizado_em: new Date().toISOString(),
        nsu: dados?.transaction_id || dados?.id || null,
        autorizacao: dados?.authorization_code || null,
        bandeira: dados?.card?.brand || null,
      })
      .eq("id", pagamento.id);

    // Registra evento bruto
    await supabaseAdmin.from("pagamento_evento").insert({
      pagamentoid: pagamento.id,
      tipo: tipoEvento.toUpperCase(),
      payload,
    });

    // Se pagamento aprovado, marcar OS como CONCLUIDO
    if (tipoEvento === "charge.paid" && pagamento.ordemservicoid) {
      await supabaseAdmin
        .from("ordemservico")
        .update({ status: "CONCLUIDO" })
        .eq("id", pagamento.ordemservicoid);
    }

    // (Opcional) checar evento de NFe futura
    if (tipoEvento === "charge.paid") {
      const { data: eventosNfe } = await supabaseAdmin
        .from("pagamento_evento")
        .select("*")
        .eq("pagamentoid", pagamento.id)
        .eq("tipo", "EMITIR_NFE_PRODUTOS_QUANDO_PAGO");

      if (eventosNfe?.length) {
        console.log(
          `→ Marcar OS ${pagamento.ordemservicoid} para emissão de NFe (implementação futura)`
        );
        // aqui depois você chama o serviço que gera a nota
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Erro no webhook Stone:", err);
    return NextResponse.json(
      { ok: false, erro: "Erro interno" },
      { status: 500 }
    );
  }
}
