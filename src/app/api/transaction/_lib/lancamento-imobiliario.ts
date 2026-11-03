import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Transação criada a partir de um lançamento contábil do imóvel (despesa do
 * proprietário ou repasse a ele).
 *
 * O lançamento já está no extrato do proprietário desde que foi registrado; a
 * transação é só o lado financeiro dele — a pagar ou já paga. Por isso ela nasce
 * sem `imovel_id` (os gatilhos de `transacao` lançariam o mesmo valor no extrato
 * de novo) e como recurso de terceiros (o dinheiro é do proprietário, não entra
 * na DRE da imobiliária).
 */
export type LancamentoImobiliario = { id: number; valor: number };

const centavos = (valor: unknown) => Math.round(Number(valor ?? 0) * 100);

/** Confere antes de gravar; devolve o erro para a tela ou o lançamento conferido. */
export async function conferirLancamentoImobiliario(
  bruto: unknown,
  payload: Record<string, any>,
  totalDeParcelas: number,
): Promise<{ ok: true; lancamento: LancamentoImobiliario } | { ok: false; erro: string; status: number }> {
  const id = Number(bruto);
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, erro: "Lançamento contábil inválido.", status: 400 };

  const { data: lancamento, error } = await supabaseAdmin
    .from("imovel_lancamento")
    .select("id, valor, cancelado_em, transacao:transacao_id ( id, is_deleted )")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!lancamento) return { ok: false, erro: "Lançamento contábil não encontrado.", status: 404 };
  if (lancamento.cancelado_em) return { ok: false, erro: "Este lançamento contábil foi estornado.", status: 409 };

  // Relação 1:1 pela coluna transacao_id; o tipo gerado do supabase-js a vê como lista.
  const atual = lancamento.transacao as unknown as { id: number; is_deleted: boolean } | null;
  if (atual && !atual.is_deleted) {
    return { ok: false, erro: `Este lançamento já está no financeiro (transação #${atual.id}).`, status: 409 };
  }
  if (String(payload.tipo ?? "").toUpperCase() !== "DESPESA") {
    return { ok: false, erro: "Despesa do proprietário e repasse são saídas: o tipo deve ser DESPESA.", status: 400 };
  }
  if (payload.ordemservicoid != null || payload.vendaid != null || payload.evento_financeiro_id != null) {
    return { ok: false, erro: "Lançamento do imóvel não pode estar ligado a OS, venda ou evento.", status: 400 };
  }
  if (totalDeParcelas > 1) {
    return { ok: false, erro: "Lançamento do imóvel não pode ser parcelado.", status: 400 };
  }
  if (centavos(payload.valor) !== centavos(lancamento.valor)) {
    const valor = Number(lancamento.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    return { ok: false, erro: `O valor deve ser o do lançamento contábil (${valor}).`, status: 400 };
  }
  return { ok: true, lancamento: { id, valor: Number(lancamento.valor) } };
}

/**
 * Liga a transação recém-criada ao lançamento. Se outro lançamento ganhou a corrida
 * entre a conferência e a gravação, a transação criada aqui é excluída e o erro volta.
 */
export async function vincularLancamentoImobiliario(lancamentoId: number, transacaoId: number) {
  const { error } = await supabaseAdmin.rpc("imob_vincular_lancamento", {
    p_lancamento_id: lancamentoId,
    p_transacao_id: transacaoId,
  });
  if (!error) return null;
  await supabaseAdmin
    .from("transacao")
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq("id", transacaoId);
  return error.message || "Não foi possível ligar a transação ao lançamento contábil.";
}

const reais = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Pagamento de reserva lançado pelo diálogo de transação, como o pagamento da OS: em
 * quantas transações forem (à vista ou a prazo), somando no máximo o total da reserva.
 *
 * A transação nasce com os vínculos do imobiliário (imóvel, proprietário, reserva,
 * natureza RECEBIMENTO, percentual de administração da reserva); paga, os gatilhos de
 * `transacao` lançam o bruto e a taxa no extrato do proprietário e atualizam a situação
 * financeira da reserva.
 */
export async function conferirPagamentoDeReserva(
  bruto: unknown,
  payload: Record<string, any>,
  totalCentavos: number,
): Promise<{ ok: true; campos: Record<string, unknown> } | { ok: false; erro: string; status: number }> {
  const id = Number(bruto);
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, erro: "Reserva inválida.", status: 400 };

  const { data: reserva, error } = await supabaseAdmin
    .from("reserva_imovel")
    .select("id, imovel_id, proprietario_id, cliente_id, valor_total, percentual_admin, status, inicio")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!reserva) return { ok: false, erro: "Reserva não encontrada.", status: 404 };
  if (reserva.status === "CANCELADA") return { ok: false, erro: "Reserva cancelada não recebe pagamentos.", status: 409 };
  if (String(payload.tipo ?? "").toUpperCase() !== "RECEITA") {
    return { ok: false, erro: "Pagamento de reserva é entrada: o tipo deve ser RECEITA.", status: 400 };
  }
  if (payload.ordemservicoid != null || payload.vendaid != null || payload.evento_financeiro_id != null) {
    return { ok: false, erro: "Pagamento de reserva não pode estar ligado a OS, venda ou evento.", status: 400 };
  }

  // O que já foi lançado (pago ou a prazo) conta contra o total, como na OS.
  const { data: lancadas, error: lancadasError } = await supabaseAdmin
    .from("transacao")
    .select("valor")
    .eq("reserva_imovel_id", id)
    .eq("imovel_natureza", "RECEBIMENTO")
    .is("baixa_de_transacao_id", null)
    .eq("is_deleted", false);
  if (lancadasError) throw lancadasError;
  const lancado = (lancadas ?? []).reduce((soma, linha) => soma + centavos(linha.valor), 0);
  const disponivel = centavos(reserva.valor_total) - lancado;
  if (totalCentavos > disponivel) {
    return {
      ok: false,
      erro: `O pagamento (${reais(totalCentavos)}) passa do saldo da reserva. Disponível para lançar: ${reais(Math.max(disponivel, 0))}.`,
      status: 409,
    };
  }

  const inicio = String(reserva.inicio).slice(0, 7);
  return {
    ok: true,
    campos: {
      imovel_id: reserva.imovel_id,
      proprietario_id: reserva.proprietario_id,
      reserva_imovel_id: id,
      imovel_natureza: "RECEBIMENTO",
      recurso_terceiros: true,
      imovel_percentual_admin: reserva.percentual_admin,
      imovel_competencia: `${inicio}-01`,
      origem: "IMOBILIARIO",
      ...(payload.cliente_id == null ? { cliente_id: reserva.cliente_id } : {}),
    },
  };
}
