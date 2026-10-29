// src/app/(app)/(pages)/meu-perfil/types.ts

export type RelacaoNomeada = { id: number; nome: string | null };

export type MeuPerfil = {
  id: string;
  nome: string | null;
  email: string | null;
  fotoUrl: string | null;
  ativo: boolean;
  dataAdmissao: string | null;
  perfil: RelacaoNomeada | null;
  setor: RelacaoNomeada | null;
};

export type ResumoValor = {
  quantidade: number;
  valor: number;
  parcial: boolean;
};

export type MeuResumo = {
  periodo: { de: string | null; ate: string | null };
  vendas: ResumoValor;
};

export type ItemVenda = {
  id: number;
  produtoId: number | null;
  titulo: string;
  referencia: string | null;
  unidade: string | null;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
};

export type MinhaVenda = {
  comissao?: import("@/lib/vendas/comissao").ComissaoVendaSnapshot | null;
  id: number;
  status: string | null;
  canal: string | null;
  dataVenda: string | null;
  /** `venda.orcamento_em` — nulo quando a venda não passou por orçamento. */
  orcamentoEm: string | null;
  /** `venda.pagamento_em` — eixo de período da aba. */
  pagamentoEm: string | null;
  /** `venda.baixada_em` — nulo enquanto a venda não é quitada. */
  baixadaEm: string | null;
  formaPagamento: string | null;
  subTotal: number;
  valorFrete: number;
  valorTotal: number;
  cliente: RelacaoNomeada | null;
  itens: ItemVenda[];
  quantidadeItens: number;
};

/**
 * Totais da aba de vendas, sobre todo o período filtrado.
 *
 * As parcelas fecham: `produtos − descontos + frete = total`. Elas existem
 * separadas porque a soma dos produtos vendidos não é o valor das vendas
 * quando há frete ou desconto no meio.
 */
export type IndicadoresVendas = {
  comissao?: number;
  vendas: number;
  /** Soma dos itens, antes de desconto e frete. */
  produtos: number;
  frete: number;
  descontos: number;
  /** `venda.valortotal` — o valor fechado da venda. */
  total: number;
  parcial: boolean;
};

export type Paginado<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type Periodo = { de: string; ate: string };

export type AbaCentral = "vendas";
