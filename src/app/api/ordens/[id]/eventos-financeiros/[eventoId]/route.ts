import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireOSEdit, requireOSEventosFinanceiros } from "@/app/api/_authz/perms";
import { mesesDeCompetenciaFechada } from "../_lib/competencia";
import { bloqueioDeStatusParaEventos } from "../_lib/status-os";
import { analisarExclusaoEventoFinanceiro } from "@/lib/ordens/exclusao-evento-financeiro";

type Params = { id: string; eventoId: string };

function idsDosParametros({ id, eventoId }: Params) {
  const osId = Number(id);
  const eventId = Number(eventoId);
  return Number.isInteger(osId) && Number.isInteger(eventId) && osId > 0 && eventId > 0
    ? { osId, eventId }
    : null;
}

const EVENTO_EXCLUSAO_SELECT =
  "id, origem, natureza, status, descricao, valor, chave_origem, is_manual, transacaoid, lancamento_id, competencia_em, quantidade_snapshot, consumo_saida_id, consumo_usoconsumo_saida_id, dados_snapshot";

async function carregarImpactoExclusao(parametros: Params) {
  const ids = idsDosParametros(parametros);
  if (!ids) return { erro: "Identificador inválido.", status: 400 as const };

  const [{ data: os, error: osError }, { data: evento, error: eventoError }] = await Promise.all([
    supabaseAdmin
      .from("ordemservico")
      .select("id, status")
      .eq("id", ids.osId)
      .eq("is_deleted", false)
      .maybeSingle(),
    supabaseAdmin
      .from("eventos_financeiros")
      .select(EVENTO_EXCLUSAO_SELECT)
      .eq("id", ids.eventId)
      .eq("ordemservicoid", ids.osId)
      .maybeSingle(),
  ]);
  if (osError) throw osError;
  if (eventoError) throw eventoError;
  if (!os) return { erro: "OS não encontrada.", status: 404 as const };
  if (!evento) return { erro: "Evento financeiro não encontrado.", status: 404 as const };

  const mesesFechados = mesesDeCompetenciaFechada([evento.competencia_em]);
  return {
    ids,
    impacto: analisarExclusaoEventoFinanceiro(evento as any, {
      statusOs: os.status,
      mesesFechados,
    }),
    mesesFechados,
  };
}

export async function GET(_: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    await requireOSEdit();
    await requireOSEventosFinanceiros();
    const contexto = await carregarImpactoExclusao(await params);
    if ("erro" in contexto) {
      return NextResponse.json({ error: contexto.erro }, { status: contexto.status });
    }
    return NextResponse.json({ impacto: contexto.impacto });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Erro ao analisar a exclusão do evento financeiro." },
      { status: error?.statusCode || 500 },
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    await requireOSEdit();
    await requireOSEventosFinanceiros();
    const contexto = await carregarImpactoExclusao(await params);
    if ("erro" in contexto) {
      return NextResponse.json({ error: contexto.erro }, { status: contexto.status });
    }
    if (!contexto.impacto.podeExcluir) {
      return NextResponse.json(
        { error: contexto.impacto.bloqueio, impacto: contexto.impacto },
        { status: 409 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const motivo = String(body?.motivo ?? "").trim();
    if (contexto.impacto.exigeMotivo && !motivo) {
      return NextResponse.json(
        { error: "Informe o motivo para devolver o item ao estoque." },
        { status: 400 },
      );
    }

    const session = await auth();
    const usuarioId = (session?.user as any)?.id ?? null;
    const { data, error } = await supabaseAdmin.rpc("excluir_evento_financeiro_manual_os", {
      p_ordemservico_id: contexto.ids.osId,
      p_evento_id: contexto.ids.eventId,
      p_motivo: motivo || null,
      p_usuario: usuarioId,
    });
    if (error) {
      const mensagem = String(error.message || "");
      const impactoAtualizado = await carregarImpactoExclusao({
        id: String(contexto.ids.osId),
        eventoId: String(contexto.ids.eventId),
      });
      const status = /n[aã]o encontrad/i.test(mensagem) ? 404 : 409;
      return NextResponse.json({
        error: mensagem || "Não foi possível excluir o evento financeiro.",
        ...(impactoAtualizado && "impacto" in impactoAtualizado
          ? { impacto: impactoAtualizado.impacto }
          : {}),
      }, { status });
    }

    return NextResponse.json({
      excluido: true,
      resultado: data,
      impacto: contexto.impacto,
      aviso: contexto.mesesFechados.length
        ? `A DRE de ${contexto.mesesFechados.join(", ")} foi recalculada.`
        : null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Erro ao excluir evento financeiro." },
      { status: error?.statusCode || 500 },
    );
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    await requireOSEdit();
    await requireOSEventosFinanceiros();
    const { id, eventoId } = await params;
    const osId = Number(id);
    const eventId = Number(eventoId);
    if (!Number.isInteger(osId) || !Number.isInteger(eventId) || osId <= 0 || eventId <= 0) {
      return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
    }

    const { data: os, error: osError } = await supabaseAdmin
      .from("ordemservico")
      .select("id, status")
      .eq("id", osId)
      .eq("is_deleted", false)
      .maybeSingle();
    if (osError) throw osError;
    if (!os) return NextResponse.json({ error: "OS não encontrada." }, { status: 404 });
    const bloqueio = bloqueioDeStatusParaEventos(os.status);
    if (bloqueio) return NextResponse.json({ error: bloqueio }, { status: 409 });

    const body = await req.json();
    const valor = Number(body?.valor);
    if (!Number.isFinite(valor) || valor < 0) {
      return NextResponse.json({ error: "Informe um valor válido, igual ou maior que zero." }, { status: 400 });
    }

    const { data: evento, error: eventoError } = await supabaseAdmin
      .from("eventos_financeiros")
      .select("id, origem, natureza, valor, descricao, detalhe, status, transacaoid, dados_snapshot, competencia_em, is_manual")
      .eq("id", eventId)
      .eq("ordemservicoid", osId)
      .neq("status", "CANCELADO")
      .maybeSingle();
    if (eventoError) throw eventoError;
    if (!evento) return NextResponse.json({ error: "Evento financeiro não encontrado." }, { status: 404 });


    if (evento.status === "CONVERTIDO" || evento.transacaoid) {
      return NextResponse.json(
        { error: "Exclua a transação vinculada antes de editar este evento financeiro.", transacaoId: evento.transacaoid },
        { status: 409 },
      );
    }

    const editandoDespesa = evento.natureza === "DESPESA";

    /**
     * Comissão é a exceção à regra da despesa automática.
     *
     * As outras automáticas têm origem corrigível: custo de produto tem o botão
     * de sincronizar, desconto e frete saem do orçamento. Comissão não tem —
     * `valor_comissao` é derivado (`valor_base × percentual efetivo`) e a única
     * entrada humana é quem executou e a taxa do perfil. Quando o cálculo saiu
     * errado numa OS já finalizada, não existia conserto nenhum.
     *
     * O override marca `is_manual`, e isso não é efeito colateral: é o mesmo
     * campo que `reconciliar_eventos_financeiros_os` usa para não recalcular a
     * linha, e o que liga o gatilho de auditoria. Sem ele, o valor corrigido
     * voltaria sozinho no próximo toque no orçamento.
     */
    const overrideDeComissao = editandoDespesa && !evento.is_manual && evento.origem === "COMISSAO";
    if (editandoDespesa && !evento.is_manual && !overrideDeComissao) {
      return NextResponse.json(
        { error: "Despesas automáticas devem ser corrigidas na origem que gerou o evento." },
        { status: 409 },
      );
    }
    const descricao = editandoDespesa
      ? String(body?.descricao ?? evento.descricao ?? "").trim()
      : evento.descricao;
    const detalhe = editandoDespesa && body?.detalhe !== undefined
      ? String(body.detalhe ?? "").trim() || null
      : evento.detalhe;
    if (editandoDespesa && !descricao) {
      return NextResponse.json({ error: "O título da despesa é obrigatório." }, { status: 400 });
    }

    const session = await auth();
    const usuarioId = (session?.user as any)?.id ?? null;
    const ajustadoEm = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("eventos_financeiros")
      .update({
        descricao,
        detalhe,
        valor: Math.round(valor * 100) / 100,
        is_manual: evento.is_manual || overrideDeComissao,
        updated_at: ajustadoEm,
        dados_snapshot: {
          ...((evento.dados_snapshot as Record<string, unknown> | null) ?? {}),
          ajuste_manual: true,
          ajustado_em: ajustadoEm,
          ajustado_por: usuarioId,
          // Guarda o que o cálculo tinha produzido, para a correção poder ser
          // conferida depois contra a regra automática.
          ...(overrideDeComissao
            ? { comissao_ajustada_a_mao: true, valor_automatico: Number(evento.valor ?? 0) }
            : {}),
        },
      })
      .eq("id", eventId)
      .eq("ordemservicoid", osId)
      .select("*")
      .single();
    if (error) throw error;

    // O valor volta para a competência original do evento, então a DRE do mês
    // em que a execução terminou muda. Não bloqueia — é a regra escolhida —,
    // mas quem alterou precisa saber qual período foi recalculado.
    const mesesRecalculados = mesesDeCompetenciaFechada([evento.competencia_em]);
    return NextResponse.json({
      evento: data,
      aviso: mesesRecalculados.length
        ? `Este lançamento tem competência em ${mesesRecalculados.join(", ")}. A DRE desse período foi recalculada.`
        : null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Erro ao atualizar snapshot." }, { status: error?.statusCode || 500 });
  }
}
