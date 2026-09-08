// src/app/api/pagamentos/stone/pedido/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { criarPedidoPos } from "@/lib/payments/pagarme-connect";
import { requireFinanceiroCreate } from "@/app/api/_authz/perms";
import { buscarFaturamentoOsHabilitado } from "@/lib/ordens/faturamento-server";
import { podeRegistrarPagamentoOs } from "@/lib/ordens/financeiro";

export async function POST(req: NextRequest) {
  try {
    await requireFinanceiroCreate();
    const body = await req.json();

    const {
      ordemServicoId,
      valor, // em reais
      descricao,
      tipoPagamento, // "credit" | "debit" | "pix"
      parcelas,
      direto,
      emitirNfeProdutos,
    } = body;

    if (!ordemServicoId || !valor || !descricao || !tipoPagamento) {
      return NextResponse.json(
        {
          erro:
            "Campos obrigatórios: ordemServicoId, valor, descricao, tipoPagamento.",
        },
        { status: 400 }
      );
    }

    const valorNumero = Number(valor);
    if (!Number.isFinite(valorNumero) || valorNumero <= 0) {
      return NextResponse.json(
        { erro: "Valor deve ser maior que zero." },
        { status: 400 }
      );
    }

    const valorEmCentavos = Math.round(valorNumero * 100);

    // Buscar dados básicos do cliente da OS para mandar no customer
    const { data: osDados, error: errOs } = await supabaseAdmin
      .from("ordemservico")
      .select(
        `
        id,
        status,
        clienteid,
        cliente:clienteid (id, nomerazaosocial, email)
      `
      )
      .eq("id", ordemServicoId)
      .eq("is_deleted", false)
      .maybeSingle();
    if (errOs) throw errOs;
    if (!osDados) return NextResponse.json({ erro: "OS não encontrada." }, { status: 404 });
    if (!podeRegistrarPagamentoOs(osDados.status, await buscarFaturamentoOsHabilitado())) {
      return NextResponse.json({ erro: "A OS não está disponível para cobrança. Confira o status e encaminhe para Faturamento quando necessário." }, { status: 409 });
    }

    let nomeCliente: string | undefined;
    let emailCliente: string | undefined | null;

    const os: any = osDados;

    if (!errOs && os && os.cliente) {
      const clienteRel = Array.isArray(os.cliente) ? os.cliente[0] : os.cliente;

      if (clienteRel) {
        nomeCliente = String(clienteRel.nomerazaosocial ?? "");
        emailCliente = clienteRel.email ?? undefined;
      }
    }

    // 2) Criar pedido no Pagar.me / Connect Stone
    const pedido = await criarPedidoPos({
      valorEmCentavos,
      descricao,
      direto: direto ?? true,
      tipoPagamento,
      parcelas: tipoPagamento === "credit" ? parcelas ?? 1 : 1,
      cliente: {
        nome: nomeCliente,
        email: emailCliente || undefined,
      },
    });

    // 3) Registrar pagamento no banco
    const metodoBanco =
      tipoPagamento === "credit"
        ? "CARTAO_CREDITO_STONE"
        : tipoPagamento === "debit"
        ? "CARTAO_DEBITO_STONE"
        : "PIX_STONE";

    const providerId =
      pedido?.id ??
      pedido?.code ??
      pedido?.order?.id ??
      pedido?.order?.code ??
      null;

    const { data: pagamento, error: errPag } = await supabaseAdmin
      .from("pagamento")
      .insert({
        ordemservicoid: ordemServicoId,
        metodo: metodoBanco,
        valor: valorEmCentavos,
        status: "CRIADO",
        provider_tx_id: providerId,
        parcelas: tipoPagamento === "credit" ? parcelas ?? 1 : 1,
      })
      .select()
      .single();

    if (errPag) {
      console.error("Erro ao inserir pagamento:", errPag);
      throw new Error("Erro ao registrar pagamento no banco.");
    }

    // 4) Eventos de auditoria
    await supabaseAdmin.from("pagamento_evento").insert({
      pagamentoid: pagamento.id,
      tipo: "STONE_PEDIDO_CRIADO",
      payload: pedido,
    });

    if (emitirNfeProdutos) {
      await supabaseAdmin.from("pagamento_evento").insert({
        pagamentoid: pagamento.id,
        tipo: "EMITIR_NFE_PRODUTOS_QUANDO_PAGO",
        payload: {
          ordemservicoid: ordemServicoId,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      pagamentoId: pagamento.id,
      status: pagamento.status,
      pedidoId: pedido.id ?? null,
      pedidoCode: pedido.code ?? null,
    });
  } catch (e: any) {
    console.error("Erro na rota /api/pagamentos/stone/pedido:", e);
    return NextResponse.json(
      {
        erro:
          e?.message ||
          "Erro inesperado ao criar pedido para a maquineta Stone.",
      },
      { status: e?.statusCode || 500 }
    );
  }
}
