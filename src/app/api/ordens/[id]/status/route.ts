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
import {
  statusExcluiTransacoesFinanceirasOs,
  validarSnapshotTransacoesDaOs,
} from "@/app/api/ordens/_lib/exclusao-financeira";
import {
  CODIGO_REALIZADORES_PENDENTES,
  mensagemRealizadoresPendentes,
  type AcaoRealizadores,
} from "@/lib/ordens/realizadores";
import { buscarServicosSemRealizador } from "@/lib/ordens/realizadores-server";
import { buscarFaturamentoOsHabilitado } from "@/lib/ordens/faturamento-server";

type DBStatusOS =
  | "AGUARDANDO_CHECKLIST"
  | "ORCAMENTO"
  | "APROVACAO_ORCAMENTO"
  | "ORCAMENTO_APROVADO"
  | "ORCAMENTO_RECUSADO"
  | "EM_ANDAMENTO"
  | "PAGAMENTO"
  | "FATURAMENTO"
  | "SEM_COBRANCA"
  | "CONCLUIDO"
  | "CANCELADO";

type DBAprovacao = "PENDENTE" | "APROVADA" | "REPROVADA";
type FormaPagamento = PlannedPayment["metodo"];

type Body = {
  status: DBStatusOS;
  semCobranca?: boolean;
  transicaoFaturamento?: boolean;
  motivoSemCobranca?: string | null;
  formaPagamento?: FormaPagamento | null;
  parcelasPagamento?: number | null;
  pagamentosPrevistos?: PlannedPayment[];
  descricaoFinanceiro?: string | null;
  garantia?: string | null;
  transacoesFinanceirasEsperadas?: Array<string | number>;
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
    // Não reutilizar a finalização da execução para devolver uma OS: ela
    // também salva condições comerciais que devem ser preservadas aqui.
    if (status === "FATURAMENTO" || status === "PAGAMENTO") {
      const atual = await supabaseAdmin.from("ordemservico").select("status")
        .eq("id", osId).eq("is_deleted", false).maybeSingle();
      if (atual.error) throw atual.error;
      if (!atual.data) return NextResponse.json({ error: "OS não encontrada." }, { status: 404 });
      if (status !== "FATURAMENTO" && (atual.data.status === "FATURAMENTO" || body.transicaoFaturamento)) {
        const result = await supabaseAdmin.rpc("transicionar_faturamento_os", { p_os_id: osId, p_status: status });
        if (result.error) return NextResponse.json({ error: result.error.message }, { status: 409 });
        return NextResponse.json({ ok: true, status: result.data.status });
      }
    }
    const semCobranca = Boolean(body.semCobranca);
    const faturamentoAtivo = status === "PAGAMENTO" || status === "FATURAMENTO"
      ? await buscarFaturamentoOsHabilitado() : false;
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
      "EM_ANDAMENTO",
      "PAGAMENTO",
  "FATURAMENTO",
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
            error: `Existem ${pendentes} produto(s) avulso(s) pendente(s). Vincule ou cadastre esses produtos antes de iniciar ou finalizar a OS.`,
            codigo: "PRODUTOS_AVULSOS_PENDENTES",
            quantidade: pendentes,
          },
          { status: 409 },
        );
      }
    }

    // Realizador de serviço é cobrado em dois momentos: ao iniciar a OS pelo
    // fluxo normal e ao fechar a execução. No meio do caminho ele pode faltar,
    // porque o módulo de execução deixa o próprio mecânico se atribuir — quem
    // segura essa OS é a trava do pagamento.
    //
    // SEM_COBRANCA fica de fora de propósito: ali o total vai a zero e a
    // comissão junto, então o realizador não muda nada financeiro e travar só
    // prenderia OS que precisam ser baixadas.
    const acaoRealizadores: AcaoRealizadores | null = semCobranca
      ? null
      : status === "EM_ANDAMENTO"
        ? "iniciar"
        : status === "PAGAMENTO" || status === "CONCLUIDO"
          ? "pagamento"
          : null;

    if (acaoRealizadores) {
      const pendentes = await buscarServicosSemRealizador(osId);
      if (pendentes.length > 0) {
        return NextResponse.json(
          {
            error: mensagemRealizadoresPendentes(pendentes, acaoRealizadores),
            codigo: CODIGO_REALIZADORES_PENDENTES,
            servicos: pendentes,
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
          pagamento.metodo === "CREDITO" ||
          pagamento.metodo === "BOLETO" ||
          pagamento.metodo === "PROMISSORIA";
        if (
          aceitaParcelas &&
          (!Number.isInteger(pagamento.parcelas) ||
            Number(pagamento.parcelas) < 1 ||
            Number(pagamento.parcelas) > 12)
        ) {
          return NextResponse.json(
            { error: "As parcelas de Crédito, Boleto ou Promissória devem estar entre 1 e 12." },
            { status: 400 },
          );
        }
        if (!aceitaParcelas) pagamento.parcelas = null;
      }
    }
    if (
      parcelasPagamento !== null &&
      formaPagamento !== "CREDITO" &&
      formaPagamento !== "BOLETO" &&
      formaPagamento !== "PROMISSORIA"
    ) {
      return NextResponse.json(
        { error: "Parcelamento disponível apenas para Crédito, Boleto ou Promissória." },
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
    let statusFinal: DBStatusOS = status;

    if (status === "FATURAMENTO" || (status === "PAGAMENTO" && !faturamentoAtivo)) {
      const resumoRes = await supabaseAdmin.rpc("resumo_financeiro_os", {
        p_ordemservicoid: osId,
      });
      if (resumoRes.error) throw resumoRes.error;
      const resumoFinanceiro = Array.isArray(resumoRes.data)
        ? resumoRes.data[0]
        : resumoRes.data;
      if (!resumoFinanceiro) {
        return NextResponse.json({ error: "OS não encontrada." }, { status: 404 });
      }
      const saldoDisponivelCents = Math.max(
        0,
        Math.round(Number(resumoFinanceiro.saldo_disponivel_lancamento ?? 0) * 100),
      );

      if (status === "FATURAMENTO" && saldoDisponivelCents > 0 && !pagamentosPrevistos?.length) {
        return NextResponse.json({ error: "Informe as condições de pagamento acordadas com o cliente." }, { status: 400 });
      }

      if (pagamentosPrevistos && pagamentosPrevistos.length > 0) {
        const totalPagamentosCents = pagamentosPrevistos.reduce(
          (total, pagamento) => total + Math.round(pagamento.valor * 100),
          0,
        );
        if (totalPagamentosCents !== saldoDisponivelCents) {
          return NextResponse.json(
            { error: "A soma dos pagamentos previstos precisa fechar apenas o saldo ainda não coberto da OS." },
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

    if (status === "FATURAMENTO") {
      const result = await supabaseAdmin.rpc("transicionar_faturamento_os", {
        p_os_id: osId,
        p_status: status,
        p_condicoes: {
          pagamentos_previstos: updateData.pagamentos_previstos,
          forma_pagamento: updateData.forma_pagamento,
          parcelas_pagamento: updateData.parcelas_pagamento,
          descricao_financeiro: updateData.descricao_financeiro,
          ...(body.garantia !== undefined ? { garantia: updateData.garantia } : {}),
        },
      });
      if (result.error) return NextResponse.json({ error: result.error.message }, { status: 409 });
      return NextResponse.json({ ok: true, status: result.data.status });
    }
    if (status === "PAGAMENTO" && faturamentoAtivo && body.garantia !== undefined) {
      updateData.garantia = garantia;
    }

    if (statusaprovacao !== null) {
      updateData.statusaprovacao = statusaprovacao;
    }

    if (status === "EM_ANDAMENTO") {
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

    const transacoesExcluidas = statusExcluiTransacoesFinanceirasOs(status)
      ? await validarSnapshotTransacoesDaOs(
          osId,
          body.transacoesFinanceirasEsperadas,
        )
      : [];

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
          valor_frete: 0,
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

    if (status === "PAGAMENTO") {
      const recalc = await supabaseAdmin.rpc("recalcular_status_financeiro_os", {
        p_ordemservicoid: osId,
      });
      if (recalc.error) throw recalc.error;
      const statusRes = await supabaseAdmin
        .from("ordemservico")
        .select("status")
        .eq("id", osId)
        .single();
      if (statusRes.error) throw statusRes.error;
      statusFinal = statusRes.data.status as DBStatusOS;
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
        status: statusFinal,
        statusaprovacao,
        formaPagamento,
        parcelasPagamento,
        pagamentosPrevistos,
        descricaoFinanceiro,
        garantia,
        transacoesExcluidas,
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error("PUT /api/ordens/[id]/status", err);
    return NextResponse.json(
      {
        error: err?.message || "Falha ao atualizar status",
        codigo: err?.codigo,
      },
      { status: err?.statusCode || (["P0001", "23514"].includes(err?.code) ? 409 : 500) },
    );
  }
}
