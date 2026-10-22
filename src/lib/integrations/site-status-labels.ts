const labels: Record<string, string> = {
 RECEIVED:'Pagamento recebido',CONFIRMED:'Pagamento confirmado',RECEIVED_IN_CASH:'Recebido em dinheiro',
 PENDING:'Aguardando pagamento',OVERDUE:'Pagamento vencido',AUTHORIZED:'Pagamento autorizado',
 AWAITING_RISK_ANALYSIS:'Pagamento em análise',REFUNDED:'Estorno confirmado',
 REFUND_REQUESTED:'Estorno solicitado',REFUND_IN_PROGRESS:'Estorno em processamento',REQUESTING:'Solicitando estorno',
 DENIED:'Estorno recusado',AWAITING_CUSTOMER:'Aguardando dados do cliente',
 AWAITING_CRITICAL_ACTION_AUTHORIZATION:'Aguardando autorização no Asaas',
 CHARGEBACK_REQUESTED:'Contestação solicitada',CHARGEBACK_DISPUTE:'Contestação em análise',
 AWAITING_CHARGEBACK_REVERSAL:'Aguardando reversão da contestação',
 DUNNING_REQUESTED:'Cobrança de inadimplência solicitada',DUNNING_RECEIVED:'Cobrança de inadimplência recebida',
 CANCELLED:'Cancelado',CANCELED:'Cancelado',DELETED:'Cancelado',FAILED:'Falha no pagamento',
 PREPARING:'Preparando pagamento',SENDING:'Consultando pagamento',BOUND:'Aguardando pagamento',
 REVIEW:'Revisão necessária',DONE:'Concluído',RESERVED:'Estoque reservado',RELEASED:'Estoque liberado',
 SEPARACAO:'Em separação',FATURADO:'Faturado',ENVIO:'Enviado',ENVIADO:'Enviado',ENTREGUE:'Entregue',
 PAGO:'Pago',PENDENTE:'Pendente',CANCELADO:'Cancelado',CANCELADA:'Cancelada',
 AGUARDANDO_PAGAMENTO:'Aguardando pagamento',PAGAMENTO_EM_ANALISE:'Pagamento em análise',
 REVISAO_NECESSARIA:'Pagamento em revisão',PAGAMENTO_CONFIRMADO:'Pagamento confirmado',
 AUTHORIZED_INVOICE:'Nota autorizada',PROCESSING:'Em processamento',ERROR:'Erro',
 RASCUNHO:'Rascunho',AUTORIZADA:'Autorizada',REJEITADA:'Rejeitada',DENEGADA:'Denegada',ENVIADA:'Enviada',
 DRAFT:'Rascunho',REJECTED:'Rejeitada',APPROVED:'Aprovado',IMPORTED:'Importado',
 IMPORTADA:'Importada',PROCESSANDO:'Processando',ERRO:'Erro',
};

/** Presentation only: provider codes remain unchanged in storage and integrations. */
export function siteStatusLabel(value?:string|null, empty='Não informado'):string {
 if(!value?.trim())return empty;
 return labels[value.trim().toUpperCase()]||'Situação não identificada';
}
