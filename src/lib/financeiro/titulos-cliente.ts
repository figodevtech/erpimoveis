import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { TituloClienteInput } from "@/lib/financeiro/score-cliente";

function numero(valor: unknown) {
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : 0;
}

/**
 * Títulos do cliente prontos para `calcularScoreCliente`.
 *
 * Quem decide de quem é cada título é a view `public.transacao_cliente`, por
 * trás da RPC `titulos_do_cliente`. Antes a busca era feita aqui, por duas
 * consultas com `!inner` em `ordemservicoid` e `vendaid` — o que deixava de
 * fora todo título que não pendura em OS nem em venda. Receita avulsa lançada
 * direto no fluxo de caixa e título vindo de carga de outro sistema ficavam
 * invisíveis no cadastro, mesmo com `cliente_id` preenchido e correto.
 *
 * A regra de precedência (`cliente_id`, senão a OS, senão a venda) mora no
 * banco justamente para que esta função e a coluna de dívida da listagem nunca
 * discordem sobre o mesmo cliente.
 *
 * O que não bate continua sem dono: título sem `cliente_id` e sem documento de
 * origem não é atribuído a ninguém por semelhança de nome.
 */
export async function carregarTitulosDoCliente(
  clienteId: number,
): Promise<TituloClienteInput[]> {
  const { data, error } = await supabaseAdmin.rpc("titulos_do_cliente", {
    p_cliente_id: clienteId,
  });

  if (error) throw error;

  return ((data ?? []) as any[]).map((transacao) => ({
    id: Number(transacao.id),
    valor: numero(transacao.valor),
    valorAcrescimos: numero(transacao.valor_acrescimos),
    valorBaixado: numero(transacao.valor_baixado),
    pendente: Boolean(transacao.pendente),
    data: String(transacao.data),
    vencimentoEm: transacao.vencimento_em ?? null,
    pagoEm: transacao.pago_em ?? null,
    ordemServicoId: transacao.ordemservicoid == null
      ? null
      : Number(transacao.ordemservicoid),
    vendaId: transacao.vendaid == null ? null : Number(transacao.vendaid),
    metodoPagamento: transacao.metodopagamento ?? null,
    origem: transacao.origem ?? null,
  }));
}
