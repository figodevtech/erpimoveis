import type {
  OperationalEvent,
  OperationalEventType,
  OperationalModule,
  OperationalPriority,
} from "./contracts";

export type OperationalFlowDirection = "PARA_NUCLEO" | "DO_NUCLEO";

export type OperationalEventVisual = {
  modulo: OperationalModule;
  estado: string;
  direcao: OperationalFlowDirection;
  prioridade: OperationalPriority;
};

const EVENT_VISUALS: Record<OperationalEventType, OperationalEventVisual> = {
  OS_CRIADA: { modulo: "ORDENS", estado: "RECEBENDO", direcao: "PARA_NUCLEO", prioridade: "INFO" },
  OS_INICIO_EXECUCAO: { modulo: "ORDENS", estado: "EXECUTANDO", direcao: "PARA_NUCLEO", prioridade: "INFO" },
  OS_FINALIZADA: { modulo: "ORDENS", estado: "FINALIZANDO", direcao: "PARA_NUCLEO", prioridade: "INFO" },
  OS_CANCELADA: { modulo: "ORDENS", estado: "ATENÇÃO", direcao: "PARA_NUCLEO", prioridade: "ATENCAO" },
  OS_AGUARDANDO_PAGAMENTO: { modulo: "ORDENS", estado: "FATURANDO", direcao: "PARA_NUCLEO", prioridade: "INFO" },
  VENDA_CRIADA: { modulo: "VENDAS", estado: "PROCESSANDO", direcao: "PARA_NUCLEO", prioridade: "INFO" },
  VENDA_CONFIRMADA: { modulo: "VENDAS", estado: "CONFIRMANDO", direcao: "PARA_NUCLEO", prioridade: "INFO" },
  VENDA_CANCELADA: { modulo: "VENDAS", estado: "ATENÇÃO", direcao: "PARA_NUCLEO", prioridade: "ATENCAO" },
  PAGAMENTO_RECEBIDO: { modulo: "FINANCEIRO", estado: "RECEBENDO", direcao: "PARA_NUCLEO", prioridade: "INFO" },
  TRANSACAO_CRIADA: { modulo: "FINANCEIRO", estado: "CONCILIANDO", direcao: "PARA_NUCLEO", prioridade: "INFO" },
  TRANSACAO_PAGA: { modulo: "FINANCEIRO", estado: "CONCILIANDO", direcao: "PARA_NUCLEO", prioridade: "INFO" },
  PIX_RECEBIDO: { modulo: "FINANCEIRO", estado: "RECEBENDO", direcao: "PARA_NUCLEO", prioridade: "INFO" },
  ESTOQUE_ENTRADA: { modulo: "ESTOQUE", estado: "RECEBENDO", direcao: "DO_NUCLEO", prioridade: "INFO" },
  ESTOQUE_SAIDA: { modulo: "ESTOQUE", estado: "MOVIMENTANDO", direcao: "DO_NUCLEO", prioridade: "INFO" },
  ESTOQUE_BAIXO: { modulo: "ESTOQUE", estado: "ATENÇÃO", direcao: "DO_NUCLEO", prioridade: "ATENCAO" },
  NFE_EMISSAO_INICIADA: { modulo: "FISCAL", estado: "EMITINDO", direcao: "PARA_NUCLEO", prioridade: "INFO" },
  NFE_AUTORIZADA: { modulo: "FISCAL", estado: "AUTORIZANDO", direcao: "PARA_NUCLEO", prioridade: "INFO" },
  NFE_REJEITADA: { modulo: "FISCAL", estado: "ATENÇÃO", direcao: "PARA_NUCLEO", prioridade: "CRITICO" },
  NFSE_EMISSAO_INICIADA: { modulo: "FISCAL", estado: "EMITINDO", direcao: "PARA_NUCLEO", prioridade: "INFO" },
  NFSE_AUTORIZADA: { modulo: "FISCAL", estado: "AUTORIZANDO", direcao: "PARA_NUCLEO", prioridade: "INFO" },
  NFSE_REJEITADA: { modulo: "FISCAL", estado: "ATENÇÃO", direcao: "PARA_NUCLEO", prioridade: "CRITICO" },
  CONTA_CRIADA: { modulo: "CONTAS_PAGAR", estado: "PROGRAMANDO", direcao: "PARA_NUCLEO", prioridade: "INFO" },
  CONTA_PAGA: { modulo: "CONTAS_PAGAR", estado: "LIQUIDANDO", direcao: "PARA_NUCLEO", prioridade: "INFO" },
  CONTA_VENCIDA: { modulo: "CONTAS_PAGAR", estado: "ATENÇÃO", direcao: "PARA_NUCLEO", prioridade: "CRITICO" },
};

export function operationalVisualFor(type: OperationalEventType): OperationalEventVisual {
  return EVENT_VISUALS[type];
}

export function validateOperationalEventMapping(event: OperationalEvent) {
  return EVENT_VISUALS[event.tipo].modulo === event.modulo;
}
