// src/app/api/pagamentos/stone/simular/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { processarPagamentoConcluido } from "@/lib/payments/processar-pagamento";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));

    const pagamentoIdBody = Number(body.pagamentoId);
    const ordemServicoIdBody = Number(body.ordemServicoId);
    const statusBody = String(body.status || "PAGO").toUpperCase();

    const novoStatusSimulado =
      statusBody === "PAGO" ||
      statusBody === "ESTORNADO" ||
      statusBody === "RECUSADO"
        ? (statusBody as "PAGO" | "ESTORNADO" | "RECUSADO")
        : "PAGO";

    let pagamento: any = null;

    // 1) Se veio pagamentoId, usa ele
    if (pagamentoIdBody) {
      const { data, error } = await supabaseAdmin
        .from("pagamento")
        .select("*")
        .eq("id", pagamentoIdBody)
        .maybeSingle();

      if (error || !data) {
        return NextResponse.json(
          { erro: "Pagamento não encontrado para o ID informado." },
          { status: 404 }
        );
      }

      pagamento = data;
    } else if (ordemServicoIdBody) {
      // 2) Se veio ordemServicoId, pega o último pagamento relacionado
      const { data, error } = await supabaseAdmin
        .from("pagamento")
        .select("*")
        .eq("ordemservicoid", ordemServicoIdBody)
        .order("id", { ascending: false })
        .limit(1);

      if (error || !data || !data.length) {
        return NextResponse.json(
          {
            erro:
              "Nenhum pagamento encontrado para a OS informada. Primeiro crie o pedido na maquineta.",
          },
          { status: 404 }
        );
      }

      pagamento = data[0];
    } else {
      return NextResponse.json(
        {
          erro:
            "Informe pagamentoId OU ordemServicoId para simular o pagamento.",
        },
        { status: 400 }
      );
    }

    // 3) Processar fluxo completo como se tivesse recebido webhook
    await processarPagamentoConcluido({
      pagamentoId: pagamento.id,
      novoStatus: novoStatusSimulado,
      origem: "SIMULACAO",
      dadosWebhook: {
        // payload fake só pra log
        simulado: true,
        from: "SIMULACAO_MANUAL",
      },
    });

    return NextResponse.json({
      ok: true,
      mensagem: `Pagamento ${pagamento.id} simulado como ${novoStatusSimulado}.`,
    });
  } catch (erro: any) {
    console.error("Erro em /api/pagamentos/stone/simular:", erro);
    return NextResponse.json(
      { erro: erro?.message ?? "Erro ao simular pagamento." },
      { status: 500 }
    );
  }
}
