// Resumo financeiro das relações de ordens e de vendas: os recebimentos do
// recorte por forma de pagamento, e os saldos que a folha final imprime.
//
// As duas folhas leem o mesmo par de abas da exportação — as colunas de saldo
// da aba principal e a aba "Recebimentos" —, montado pela mesma regra em
// `@/lib/relatorios/recebimentos-de-documentos`. A conta pura fica aqui, fora
// do JSX, para ser testada sem montar a página.

type Cell = string | number | boolean | null;


/** Um recebimento da aba "Recebimentos", já repartido pela rota. */
export type RecebimentoDaFolha = {
  /** Número da OS ou da venda. */
  documento: string;
  metodo: string;
  recebido: number;
  pendenteVencido: number;
  pendenteAVencer: number;
};

export type ResumoDoMetodo = {
  /** Código gravado na transação; vazio quando ela não tem método. */
  metodo: string;
  lancamentos: number;
  recebido: number;
  pendenteVencido: number;
  pendenteAVencer: number;
  total: number;
};

const centavos = (valor: number) => Math.round(valor * 100) / 100;

/**
 * Uma linha por forma de pagamento, da maior para a menor.
 *
 * O título pago em parte conta nas duas colunas e uma vez só em `lancamentos`:
 * ele é um lançamento, com dinheiro já entrado e saldo em aberto.
 */
export function resumirRecebimentosPorMetodo(linhas: RecebimentoDaFolha[]): ResumoDoMetodo[] {
  const porMetodo = new Map<string, ResumoDoMetodo>();

  for (const linha of linhas) {
    const metodo = linha.metodo.trim().toUpperCase();
    const atual = porMetodo.get(metodo) ?? {
      metodo,
      lancamentos: 0,
      recebido: 0,
      pendenteVencido: 0,
      pendenteAVencer: 0,
      total: 0,
    };
    atual.lancamentos += 1;
    atual.recebido += linha.recebido;
    atual.pendenteVencido += linha.pendenteVencido;
    atual.pendenteAVencer += linha.pendenteAVencer;
    porMetodo.set(metodo, atual);
  }

  return [...porMetodo.values()]
    .map((resumo) => ({
      ...resumo,
      recebido: centavos(resumo.recebido),
      pendenteVencido: centavos(resumo.pendenteVencido),
      pendenteAVencer: centavos(resumo.pendenteAVencer),
      total: centavos(resumo.recebido + resumo.pendenteVencido + resumo.pendenteAVencer),
    }))
    .sort((a, b) => b.total - a.total || a.metodo.localeCompare(b.metodo, "pt-BR"));
}

/** Os saldos do recorte, somados das colunas por documento da exportação. */
export type SaldosDoRecorte = {
  recebido: number;
  pendenteVencido: number;
  pendenteAVencer: number;
  /** A parte do valor dos documentos que nenhum pagamento cobre ainda. */
  semLancamento: number;
};

export const SALDOS_ZERADOS: SaldosDoRecorte = { recebido: 0, pendenteVencido: 0, pendenteAVencer: 0, semLancamento: 0 };

type LeitorDeAba = { rows: Cell[][]; read: (row: Cell[], label: string) => Cell };

const numero = (value: Cell) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Os saldos e os recebimentos, lidos por nome de coluna. `colunaDoDocumento` é
 * "OS" numa relação e "Venda" na outra.
 *
 * Planilha sem as colunas — exportação anterior ao resumo — devolve tudo zerado,
 * e a folha diz que não há pagamento lançado em vez de quebrar.
 */
export function lerResumoFinanceiro(
  principal: LeitorDeAba,
  recebimentos: LeitorDeAba | null,
  colunaDoDocumento: string,
): { saldos: SaldosDoRecorte; recebimentos: RecebimentoDaFolha[] } {
  const somar = (rotulo: string) => principal.rows.reduce((soma, row) => soma + numero(principal.read(row, rotulo)), 0);

  return {
    saldos: {
      recebido: somar("Recebido (R$)"),
      pendenteVencido: somar("Pendente vencido (R$)"),
      pendenteAVencer: somar("Pendente a vencer (R$)"),
      semLancamento: somar("Sem lançamento (R$)"),
    },
    recebimentos: (recebimentos?.rows ?? []).map((row) => ({
      documento: String(recebimentos!.read(row, colunaDoDocumento) ?? "").trim(),
      metodo: String(recebimentos!.read(row, "Método") ?? ""),
      recebido: numero(recebimentos!.read(row, "Recebido (R$)")),
      pendenteVencido: numero(recebimentos!.read(row, "Pendente vencido (R$)")),
      pendenteAVencer: numero(recebimentos!.read(row, "Pendente a vencer (R$)")),
    })),
  };
}
