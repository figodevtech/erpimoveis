export const STATUS_VENDAS = [
  ["ORCAMENTO", "Orçamento"],
  ["APROVACAO_ORCAMENTO", "Aguardando aprovação"],
  ["ORCAMENTO_APROVADO", "Orçamento aprovado"],
  ["ORCAMENTO_RECUSADO", "Orçamento recusado"],
  ["ABERTA", "Aberta"],
  ["PAGAMENTO", "Em pagamento"],
  ["FINALIZADA", "Finalizada"],
  ["CANCELADA", "Cancelada"],
] as const;

export const CANAIS_VENDAS = [
  ["PDV", "PDV (balcão)"], ["ONLINE", "Site próprio"],
  ["MERCADO_LIVRE", "Mercado Livre"], ["SHOPEE", "Shopee"],
] as const;

export const ENTREGAS_VENDAS = [
  ["NAO_INICIADA", "Não iniciada"], ["SEPARACAO", "Em separação"],
  ["ENVIO", "Em envio"], ["ENTREGUE", "Entregue"],
] as const;

export type VendasListFilters = {
  cliente: string;
  notaNumero: string;
  dataInicio?: Date;
  dataFim?: Date;
  apenasMinhas?: boolean;
  valorMin?: number;
  valorMax?: number;
  canal?: string;
  categoriaVendaId?: string;
  vendedorId?: string;
  status?: (typeof STATUS_VENDAS)[number][0];
  statusEntrega?: string;
};

export function dataDoFiltro(data?: Date) {
  if (!data) return "";
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

export function erroNosFiltros(filtros: VendasListFilters): string | null {
  if (filtros.dataInicio && filtros.dataFim && filtros.dataInicio > filtros.dataFim) return "A data inicial não pode ser posterior à data final.";
  if ([filtros.valorMin, filtros.valorMax].some((valor) => valor !== undefined && (!Number.isFinite(valor) || valor < 0))) return "Informe valores válidos, maiores ou iguais a zero.";
  if (filtros.valorMin !== undefined && filtros.valorMax !== undefined && filtros.valorMin > filtros.valorMax) return "O valor mínimo não pode ser maior que o máximo.";
  return null;
}

export function quantidadeFiltros(filtros: VendasListFilters) {
  return Object.values(filtros).filter((valor) => valor !== undefined && valor !== "" && valor !== false).length;
}
