/**
 * Catálogo de avisos instantâneos do fluxo de caixa.
 *
 * Todo caminho de baixa — a rota comum, o adiantamento, o pagamento múltiplo,
 * o desfazimento — termina mexendo em `pendente` na linha de `transacao`. Por
 * isso o gatilho mora lá, e não no livro `transacao_baixa_historico`, que é mais
 * bonito semanticamente mas não é escrito por todos eles.
 */
export const FINANCEIRO_NOTIFICATION_EVENT_GROUPS = [
  {
    id: "LANCAMENTO",
    label: "Lançamentos",
    description: "Contas registradas e dinheiro movimentado na hora",
    events: [
      ["CONTA_PAGAR_CRIADA", "Conta a pagar registrada"],
      ["CONTA_RECEBER_CRIADA", "Conta a receber registrada"],
      ["MOVIMENTO_CAIXA_CRIADO", "Movimento lançado já liquidado"],
    ],
  },
  {
    id: "LIQUIDACAO",
    label: "Liquidações",
    description: "Títulos que entraram no fluxo de caixa",
    events: [
      ["CONTA_PAGAR_LIQUIDADA", "Conta a pagar baixada"],
      ["CONTA_RECEBER_LIQUIDADA", "Conta a receber baixada"],
    ],
  },
  {
    id: "DESFAZIMENTO",
    label: "Desfazimentos",
    description: "Baixa estornada e lançamento excluído",
    events: [
      ["BAIXA_ESTORNADA", "Baixa estornada"],
      ["LANCAMENTO_EXCLUIDO", "Lançamento excluído"],
    ],
  },
  {
    id: "TRANSFERENCIA",
    label: "Transferências",
    description: "Dinheiro movido entre contas da empresa",
    events: [
      ["TRANSFERENCIA_ENTRE_CONTAS", "Transferência entre contas"],
    ],
  },
] as const;

export const FINANCEIRO_NOTIFICATION_EVENT_VALUES = FINANCEIRO_NOTIFICATION_EVENT_GROUPS.flatMap(
  (group) => group.events.map(([id]) => id),
);

export type FinanceiroNotificationEvent = (typeof FINANCEIRO_NOTIFICATION_EVENT_VALUES)[number];

export function isFinanceiroNotificationEvent(value: unknown): value is FinanceiroNotificationEvent {
  return FINANCEIRO_NOTIFICATION_EVENT_VALUES.includes(value as FinanceiroNotificationEvent);
}

/**
 * De onde o lançamento veio.
 *
 * O filtro de origem existe para quem já acompanha a OS pelo módulo dela e não
 * quer receber o mesmo pagamento duas vezes. Transferência não entra na lista:
 * ela é governada só pelo próprio evento.
 */
export const FINANCEIRO_ORIGEM_OPTIONS = [
  ["AVULSO", "Avulso", "Lançado direto no financeiro"],
  ["ORDEM_SERVICO", "Ordem de serviço", "Títulos gerados por uma OS"],
  ["VENDA", "Venda", "Títulos gerados por uma venda"],
  ["ENTRADA", "Entrada de estoque", "Contas de nota de compra e uso e consumo"],
] as const;

export const FINANCEIRO_ORIGEM_VALUES = FINANCEIRO_ORIGEM_OPTIONS.map(([id]) => id);

export type FinanceiroOrigem = (typeof FINANCEIRO_ORIGEM_VALUES)[number];

export function isFinanceiroOrigem(value: unknown): value is FinanceiroOrigem {
  return FINANCEIRO_ORIGEM_VALUES.includes(value as FinanceiroOrigem);
}

export function classifyFinanceiroOrigem(row: {
  ordemservicoid?: number | null;
  vendaid?: number | null;
  entrada_id?: number | null;
  usoconsumo_entrada_id?: number | null;
}): FinanceiroOrigem {
  if (row.ordemservicoid) return "ORDEM_SERVICO";
  if (row.vendaid) return "VENDA";
  if (row.entrada_id || row.usoconsumo_entrada_id) return "ENTRADA";
  return "AVULSO";
}

/**
 * Traduz a transição da linha em evento do catálogo.
 *
 * Espelha, em TypeScript, o `CASE` do gatilho — mesma regra escrita duas vezes,
 * uma para enfileirar e outra para os testes.
 */
export function classifyFinanceiroNotificationEvent(input: {
  operacao: "INSERT" | "UPDATE";
  tipo: string | null;
  pendente: boolean | null;
  pendenteAnterior?: boolean | null;
  isDeleted?: boolean | null;
  isDeletedAnterior?: boolean | null;
  transferenciaId?: number | null;
}): FinanceiroNotificationEvent | null {
  const despesa = String(input.tipo ?? "").toUpperCase() !== "RECEITA";

  if (input.operacao === "INSERT") {
    if (input.isDeleted) return null;
    if (input.transferenciaId) return "TRANSFERENCIA_ENTRE_CONTAS";
    if (input.pendente) return despesa ? "CONTA_PAGAR_CRIADA" : "CONTA_RECEBER_CRIADA";
    return "MOVIMENTO_CAIXA_CRIADO";
  }

  // Exclusão vem antes da baixa: a linha some do fluxo, e o que aconteceu com
  // `pendente` no mesmo update deixa de importar.
  if (input.isDeleted && !input.isDeletedAnterior) return "LANCAMENTO_EXCLUIDO";
  if (input.isDeleted) return null;

  if (input.pendenteAnterior === true && input.pendente === false) {
    return despesa ? "CONTA_PAGAR_LIQUIDADA" : "CONTA_RECEBER_LIQUIDADA";
  }
  if (input.pendenteAnterior === false && input.pendente === true) return "BAIXA_ESTORNADA";
  return null;
}
