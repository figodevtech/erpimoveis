import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireOSEdit, requireOSFinalizarSemCobranca } from "@/app/api/_authz/perms";
import {
  buscarModoBaixaEstoqueOS,
  consumirEstoqueOS,
  mensagemEstoqueInsuficienteOS,
} from "@/lib/ordens/estoque-os";
import type { PlannedPayment } from "@/lib/payment-methods";
import { getPaymentMethodValues } from "@/lib/payment-methods-server";

type DBStatusOS =
  | "AGUARDANDO_CHECKLIST"
  | "ORCAMENTO"
  | "APROVACAO_ORCAMENTO"
  | "ORCAMENTO_APROVADO"
  | "ORCAMENTO_RECUSADO"
  | "EM_ANDAMENTO"
  | "PAGAMENTO"
  | "SEM_COBRANCA"
  | "CONCLUIDO"
  | "CANCELADO";

type DBAprovacao = "PENDENTE" | "APROVADA" | "REPROVADA";
type FormaPagamento = PlannedPayment["metodo"];

type Body = {
  status: DBStatusOS;
  semCobranca?: boolean;
  motivoSemCobranca?: string | null;
  formaPagamento?: FormaPagamento | null;
  parcelasPagamento?: number | null;
  pagamentosPrevistos?: PlannedPayment[];
  descricaoFinanceiro?: string | null;
  garantia?: string | null;
};

type ParamsId = { id: string };

export async function PUT(req: NextRequest, { params }: { params: Promise<ParamsId> }) {
  try {
    await requireOSEdit();
    const { id } = await params;
    const osId = Number(id);

    if (!osId) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const body = (await req.json()) as Body;
    const status = body.status;
    const semCobranca = Boolean(body.semCobranca);
    const motivoSemCobranca = (body.motivoSemCobranca ?? "").trim() || null;
    const formaPagamento = body.formaPagamento ?? null;
    const parcelasPagamento =
      body.parcelasPagamento === null || body.parcelasPagamento === undefined
        ? null
        : Number(body.parcelasPagamento);
    const pagamentosPrevistos = Array.isArray(body.pagamentosPrevistos)
      ? body.pagamentosPrevistos.map((pagamento) => ({
          metodo: String(pagamento?.metodo ?? "").toUpperCase() as FormaPagamento,
          valor: Math.round(Number(pagamento?.valor ?? 0) * 100) / 100,
          parcelas:
            pagamento?.parcelas === null || pagamento?.parcelas === undefined
              ? null
              : Number(pagamento.parcelas),
        }))
      : null;
    const descricaoFinanceiro = (body.descricaoFinanceiro ?? "").trim() || null;
    const garantia = (body.garantia ?? "").trim() || null;
    const formasPagamentoValidas = new Set(await getPaymentMethodValues());

    if (!status) {
      return NextResponse.json({ error: "Status é obrigatório." }, { status: 400 });
    }

    // Finalizar sem cobranca exige permissao propria, alem de poder editar a OS.
    if (semCobranca || status === "SEM_COBRANCA") {
      await requireOSFinalizarSemCobranca();
    }

    const statusesBloqueadosPorAvulso: DBStatusOS[] = [
      "APROVACAO_ORCAMENTO",
      "ORCAMENTO_APROVADO",
      "EM_ANDAMENTO",
      "PAGAMENTO",
      "SEM_COBRANCA",
      "CONCLUIDO",
    ];
    if (statusesBloqueadosPorAvulso.includes(status)) {
      const { count: pendentes, error: pendentesError } = await supabaseAdmin
        .from("osproduto_avulso")
        .select("id", { count: "exact", head: true })
        .eq("ordemservicoid", osId);
      if (pendentesError) throw pendentesError;
      if ((pendentes ?? 0) > 0) {
        return NextResponse.json(
          {
            error: `Existem ${pendentes} produto(s) avulso(s) pendente(s). Vincule ou cadastre esses produtos antes de avançar a OS.`,
            codigo: "PRODUTOS_AVULSOS_PENDENTES",
            quantidade: pendentes,
          },
          { status: 409 },
        );
      }
    }

    if (
      formaPagamento !== null &&
      !formasPagamentoValidas.has(formaPagamento)
    ) {
      return NextResponse.json({ error: "Forma de pagamento inválida." }, { status: 400 });
    }
    if (garantia && garantia.length > 500) {
      return NextResponse.json(
        { error: "A informação de garantia deve ter no máximo 500 caracteres." },
        { status: 400 },
      );
    }
    if (
      parcelasPagamento !== null &&
      (!Number.isInteger(parcelasPagamento) ||
        parcelasPagamento < 1 ||
        parcelasPagamento > 12)
    ) {
      return NextResponse.json(
        { error: "A quantidade de parcelas deve estar entre 1 e 12." },
        { status: 400 },
      );
    }
    if (pagamentosPrevistos) {
      const metodosInformados = new Set<string>();

      for (const pagamento of pagamentosPrevistos) {
        if (
          !formasPagamentoValidas.has(pagamento.metodo) ||
          metodosInformados.has(pagamento.metodo)
        ) {
          return NextResponse.json(
            { error: "As formas de pagamento informadas são inválidas ou estão duplicadas." },
            { status: 400 },
          );
        }
        metodosInformados.add(pagamento.metodo);

        if (!Number.isFinite(pagamento.valor) || pagamento.valor <= 0) {
          return NextResponse.json(
            { error: "Informe um valor maior que zero para cada forma de pagamento." },
            { status: 400 },
          );
        }

        const aceitaParcelas =
          pagamento.metodo === "CREDITO" || pagamento.metodo === "BOLETO";
        if (
          aceitaParcelas &&
          (!Number.isInteger(pagamento.parcelas) ||
            Number(pagamento.parcelas) < 1 ||
            Number(pagamento.parcelas) > 12)
        ) {
          return NextResponse.json(
            { error: "As parcelas de Crédito ou Boleto devem estar entre 1 e 12." },
            { status: 400 },
          );
        }
        if (!aceitaParcelas) pagamento.parcelas = null;
      }
    }
    if (
      parcelasPagamento !== null &&
      formaPagamento !== "CREDITO" &&
      formaPagamento !== "BOLETO"
    ) {
      return NextResponse.json(
        { error: "Parcelamento disponível apenas para Crédito ou Boleto." },
        { status: 400 },
      );
    }

    // define statusaprovacao em função do novo status
    if (status === "APROVACAO_ORCAMENTO") {
      const osRes = await supabaseAdmin
        .from("ordemservico")
        .select("id, clienteid, alvo_tipo, veiculoid, pecaid, equipamento_nome")
        .eq("id", osId)
        .maybeSingle();

      if (osRes.error) throw osRes.error;
      if (!osRes.data?.id) {
        return NextResponse.json({ error: "OS não encontrada." }, { status: 404 });
      }
      if (osRes.data.clienteid == null) {
        return NextResponse.json(
          { error: "Selecione um cliente antes de enviar a OS para aprovação." },
          { status: 400 }
        );
      }
      const alvoValido =
        (osRes.data.alvo_tipo === "VEICULO" && osRes.data.veiculoid != null) ||
        (osRes.data.alvo_tipo === "PECA" && osRes.data.pecaid != null) ||
        (osRes.data.alvo_tipo === "EQUIPAMENTO" && Boolean(osRes.data.equipamento_nome?.trim()));
      if (!alvoValido) {
        return NextResponse.json(
          { error: "Selecione o veículo, peça ou equipamento antes de enviar a OS para aprovação." },
          { status: 400 }
        );
      }
    }

    let statusaprovacao: DBAprovacao | null = null;

    if (status === "ORCAMENTO_APROVADO") {
      statusaprovacao = "APROVADA";
    } else if (status === "ORCAMENTO_RECUSADO") {
      statusaprovacao = "REPROVADA";
    } else if (status === "ORCAMENTO" || status === "APROVACAO_ORCAMENTO" || status === "AGUARDANDO_CHECKLIST") {
      statusaprovacao = "PENDENTE";
    }

    const updateData: any = { status };

    if (status === "PAGAMENTO") {
      if (pagamentosPrevistos && pagamentosPrevistos.length > 0) {
        const totalRes = await supabaseAdmin
          .from("ordemservico")
          .select("orcamentototal")
          .eq("id", osId)
          .maybeSingle();
        if (totalRes.error) throw totalRes.error;
        if (!totalRes.data) {
          return NextResponse.json({ error: "OS não encontrada." }, { status: 404 });
        }

        const totalOsCents = Math.round(Number(totalRes.data.orcamentototal ?? 0) * 100);
        const totalPagamentosCents = pagamentosPrevistos.reduce(
          (total, pagamento) => total + Math.round(pagamento.valor * 100),
          0,
        );
        if (totalPagamentosCents !== totalOsCents) {
          return NextResponse.json(
            { error: "A soma dos pagamentos precisa fechar o total da OS." },
            { status: 400 },
          );
        }
      }

      if (pagamentosPrevistos !== null) {
        const pagamentoUnico =
          pagamentosPrevistos.length === 1 ? pagamentosPrevistos[0] : null;
        updateData.pagamentos_previstos =
          pagamentosPrevistos.length > 0 ? pagamentosPrevistos : null;
        updateData.forma_pagamento = pagamentoUnico?.metodo ?? null;
        updateData.parcelas_pagamento = pagamentoUnico?.parcelas ?? null;
      } else {
        updateData.forma_pagamento = formaPagamento;
        updateData.parcelas_pagamento = parcelasPagamento;
        updateData.pagamentos_previstos = null;
      }
      updateData.descricao_financeiro = descricaoFinanceiro;
      updateData.garantia = garantia;
    }

    if (statusaprovacao !== null) {
      updateData.statusaprovacao = statusaprovacao;
    }

    if (status === "EM_ANDAMENTO") {
      const { data: servicos, error: servicosError } = await supabaseAdmin
        .from("osservico")
        .select("servicoid")
        .eq("ordemservicoid", osId);
      if (servicosError) throw servicosError;

      const { data: realizadores, error: realizadoresError } = await supabaseAdmin
        .from("osservico_realizador")
        .select("servicoid")
        .eq("ordemservicoid", osId);
      if (realizadoresError) throw realizadoresError;
      const servicosComRealizador = new Set((realizadores ?? []).map((item: any) => Number(item.servicoid)));
      const semRealizador = (servicos ?? []).filter((item: any) => !servicosComRealizador.has(Number(item.servicoid)));
      if (semRealizador.length > 0) {
        return NextResponse.json(
          { error: "Defina os realizadores de todos os serviços antes de iniciar a OS." },
          { status: 409 },
        );
      }

      const modoBaixa = await buscarModoBaixaEstoqueOS();
      if (modoBaixa === "EXECUCAO") {
        const baixa = await consumirEstoqueOS(osId);
        if (!baixa.ok) {
          return NextResponse.json(
            {
              error: mensagemEstoqueInsuficienteOS(baixa.faltantes),
              itens: baixa.faltantes,
            },
            { status: 409 }
          );
        }
      }
    }

    // Conclusao financeira e retirada fisica sao eventos independentes.
    if (status === "CONCLUIDO") {
      updateData.pagamento_concluido_em = new Date().toISOString();
    }
    if (semCobranca || status === "SEM_COBRANCA") {
      updateData.motivo_sem_cobranca = motivoSemCobranca;
      updateData.status = "SEM_COBRANCA";

      // Nao ha o que cobrar: o total vai a zero como desconto integral, para o
      // orcamento continuar coerente (subtotal - desconto = total) na tela e na
      // impressao.
      //
      // Precisa ser um UPDATE separado e anterior ao do status. Zerar o
      // orcamentototal dispara `trg_recalc_comissao_os_total` (AFTER), que
      // recalcula a comissao sobre a base zerada; a reconciliacao dos eventos
      // dispara `trg_reconciliar_eventos_ao_finalizar_os` (BEFORE UPDATE OF
      // status). Numa unica instrucao o BEFORE rodaria primeiro e publicaria os
      // eventos de comissao com o valor antigo.
      const zeragem = await supabaseAdmin
        .from("ordemservico")
        .update({
          desconto_tipo: "PORCENTAGEM",
          desconto: 100,
          orcamentototal: 0,
          acrescimo_financeiro_tipo: null,
          acrescimo_financeiro_valor: 0,
        })
        .eq("id", osId);
      if (zeragem.error) throw zeragem.error;
    }

    const upd = await supabaseAdmin.from("ordemservico").update(updateData).eq("id", osId);

    if (upd.error) {
      // fallback caso coluna motivo_sem_cobranca ainda não exista no banco
      if (semCobranca && upd.error.message?.includes("motivo_sem_cobranca")) {
        const fallbackData = { ...updateData };
        delete fallbackData.motivo_sem_cobranca;
        const upd2 = await supabaseAdmin.from("ordemservico").update(fallbackData).eq("id", osId);
        if (upd2.error) throw upd2.error;
      } else {
        throw upd.error;
      }
    }

    // opcional: marcar tokens da OS como "usados" quando aprovar/reprovar
    if (status === "ORCAMENTO_APROVADO" || status === "ORCAMENTO_RECUSADO") {
      const desiredAprov: DBAprovacao = status === "ORCAMENTO_APROVADO" ? "APROVADA" : "REPROVADA";

      const mark = await supabaseAdmin
        .from("osaprovacao")
        .update({
          usado_em: new Date().toISOString(),
          origem: "SISTEMA",
          resultado: desiredAprov,
        })
        .eq("ordemservicoid", osId)
        .is("usado_em", null);

      if (mark.error) {
        console.error("Falha ao marcar tokens de aprovação como usados", mark.error);
      }
    }

    return NextResponse.json(
      {
        ok: true,
        status,
        statusaprovacao,
        formaPagamento,
        parcelasPagamento,
        pagamentosPrevistos,
        descricaoFinanceiro,
        garantia,
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error("PUT /api/ordens/[id]/status", err);
    return NextResponse.json(
      { error: err?.message || "Falha ao atualizar status" },
      { status: err?.statusCode || 500 },
    );
  }
}
