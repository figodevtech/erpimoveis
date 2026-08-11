import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { TituloClienteInput } from "@/lib/financeiro/score-cliente";

const LOTE_TRANSACOES = 1_000;

function numero(valor: unknown) {
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : 0;
}

/**
 * Receitas do cliente por origem. A relação é `!inner` porque só interessam as
 * transações que realmente pendurem numa OS ou venda daquele cliente — receita
 * avulsa não entra no histórico dele.
 */
async function carregarTransacoesPorOrigem(
  clienteId: number,
  origem: "ordem" | "venda",
) {
  const transacoes: any[] = [];
  const relacao = origem === "ordem"
    ? "ordem:ordemservicoid!inner(clienteid)"
    : "venda:vendaid!inner(clienteid)";

  for (let inicio = 0; ; inicio += LOTE_TRANSACOES) {
    const { data, error } = await supabaseAdmin
      .from("transacao")
      .select(
        `id, valor, valor_acrescimos, pendente, data, vencimento_em, pago_em, ordemservicoid, vendaid, metodopagamento, ${relacao}`,
      )
      .eq(`${origem}.clienteid`, clienteId)
      .eq("tipo", "RECEITA")
      .eq("is_deleted", false)
      .is("evento_financeiro_id", null)
      .order("data", { ascending: false })
      .range(inicio, inicio + LOTE_TRANSACOES - 1);

    if (error) throw error;

    const lote = (data ?? []) as any[];
    transacoes.push(...lote);
    if (lote.length < LOTE_TRANSACOES) break;
  }

  return transacoes;
}

/**
 * Títulos do cliente prontos para `calcularScoreCliente`, sem duplicar a
 * transação que aparece nas duas origens (dedupe por id).
 */
export async function carregarTitulosDoCliente(
  clienteId: number,
): Promise<TituloClienteInput[]> {
  const [transacoesOs, transacoesVendas] = await Promise.all([
    carregarTransacoesPorOrigem(clienteId, "ordem"),
    carregarTransacoesPorOrigem(clienteId, "venda"),
  ]);

  const unicas = Array.from(
    new Map(
      [...transacoesOs, ...transacoesVendas].map((transacao) => [
        Number(transacao.id),
        transacao,
      ]),
    ).values(),
  );

  return unicas.map((transacao) => ({
    id: Number(transacao.id),
    valor: numero(transacao.valor),
    valorAcrescimos: numero(transacao.valor_acrescimos),
    pendente: Boolean(transacao.pendente),
    data: String(transacao.data),
    vencimentoEm: transacao.vencimento_em ?? null,
    pagoEm: transacao.pago_em ?? null,
    ordemServicoId: transacao.ordemservicoid == null
      ? null
      : Number(transacao.ordemservicoid),
    vendaId: transacao.vendaid == null ? null : Number(transacao.vendaid),
    metodoPagamento: transacao.metodopagamento ?? null,
  }));
}
