import { valorDeFace } from "@/lib/financeiro/transacao";
import { arredondarMoeda } from "@/lib/ordens/desconto";
import {
  calcularResumoFinanceiroOs,
  desdobrarRecebimento,
  type TransacaoFinanceiraOs,
} from "@/lib/ordens/financeiro";

/**
 * Os recebimentos de uma OS ou de uma venda, repartidos para o resumo
 * financeiro das relações de ordens e de vendas.
 *
 * As duas relações contam pela mesma regra do saldo do documento
 * (`calcularResumoFinanceiroOs`, que não tem nada de OS além do nome): valor de
 * face, título com baixa parcial dividido, pendência separada pelo vencimento.
 * Ficar num lugar só é o ponto — as duas folhas imprimem a mesma tabela, e uma
 * regra escrita duas vezes acaba contando duas coisas.
 */

export type RecebimentoDoDocumento = TransacaoFinanceiraOs & {
  id: number;
  data: string | null;
  vencimento_em?: string | null;
  metodopagamento: string | null;
};

/**
 * Colunas que a folha de impressão lê por nome. São contrato entre a rota e o
 * papel, como os demais cabeçalhos das exportações: mudar um rótulo aqui sem
 * mudar lá zera a coluna em silêncio.
 */
export const COLUNAS_DE_SALDO = [
  "Recebido (R$)",
  "Pendente vencido (R$)",
  "Pendente a vencer (R$)",
  "Sem lançamento (R$)",
] as const;

export const CABECALHOS_DE_RECEBIMENTOS = [
  "Transação",
  "Vencimento",
  "Método",
  "Situação",
  "Valor de face (R$)",
  "Recebido (R$)",
  "Pendente vencido (R$)",
  "Pendente a vencer (R$)",
] as const;

/** "2026-10-01" no fuso da operação — o vencimento é um dia, não um instante. */
export function diaLocal(value: unknown) {
  if (!value) return "";
  const texto = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  const date = value instanceof Date ? value : new Date(texto);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Um recebimento repartido: o que entrou, e o que está em aberto separado
 * entre vencido e a vencer. O vencimento é `vencimento_em` e, sem ele, a data
 * do título — a mesma leitura do score do cliente.
 */
export function reparteRecebimento(transacao: RecebimentoDoDocumento, hoje: string) {
  const { recebido, pendente } = desdobrarRecebimento(transacao);
  const vencimento = diaLocal(transacao.vencimento_em ?? transacao.data);
  const vencido = pendente > 0 && Boolean(vencimento) && vencimento < hoje;
  return {
    face: valorDeFace(transacao),
    recebido: arredondarMoeda(recebido),
    pendenteVencido: vencido ? arredondarMoeda(pendente) : 0,
    pendenteAVencer: vencido ? 0 : arredondarMoeda(pendente),
    vencimento,
  };
}

/**
 * Os quatro saldos de um documento, na ordem de `COLUNAS_DE_SALDO`.
 *
 * `semValorDevido` é para o documento cancelado, recusado ou sem cobrança: ele
 * não deve nada, e o total dele não é saldo a lançar.
 */
export function saldosDoDocumento({
  totalComercial,
  acrescimoFinanceiroTipo,
  acrescimoFinanceiroValor,
  recebimentos,
  semValorDevido,
  hoje,
}: {
  totalComercial: unknown;
  acrescimoFinanceiroTipo?: string | null;
  acrescimoFinanceiroValor?: unknown;
  recebimentos: RecebimentoDoDocumento[];
  semValorDevido: boolean;
  hoje: string;
}) {
  const resumo = calcularResumoFinanceiroOs({
    totalComercial,
    acrescimoFinanceiroTipo,
    acrescimoFinanceiroValor,
    transacoes: recebimentos,
  });
  const partes = recebimentos.map((transacao) => reparteRecebimento(transacao, hoje));
  const somar = (campo: "pendenteVencido" | "pendenteAVencer") =>
    arredondarMoeda(partes.reduce((soma, parte) => soma + parte[campo], 0));

  return [
    resumo.valorRecebido,
    somar("pendenteVencido"),
    somar("pendenteAVencer"),
    semValorDevido ? 0 : resumo.saldoDisponivelParaLancamento,
  ];
}

/**
 * A linha do recebimento na aba "Recebimentos", na ordem de
 * `CABECALHOS_DE_RECEBIMENTOS` — o número do documento vai antes, por conta de
 * quem chama, porque a coluna se chama "OS" numa relação e "Venda" na outra.
 */
export function linhaDoRecebimento(transacao: RecebimentoDoDocumento, hoje: string) {
  const parte = reparteRecebimento(transacao, hoje);
  const pendente = parte.pendenteVencido + parte.pendenteAVencer;
  const situacao =
    pendente <= 0
      ? "Baixado"
      : `${parte.recebido > 0 ? "Parcial" : "Pendente"} · ${parte.pendenteVencido > 0 ? "vencido" : "a vencer"}`;
  return [
    transacao.id,
    parte.vencimento ? parte.vencimento.split("-").reverse().join("/") : "",
    transacao.metodopagamento ?? "",
    situacao,
    parte.face,
    parte.recebido,
    parte.pendenteVencido,
    parte.pendenteAVencer,
  ];
}
