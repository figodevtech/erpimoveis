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
  ordens: ResumoValor;
  servicosRealizados: ResumoValor;
  servicosEmAndamento: { quantidade: number; parcial: boolean };
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

export type ItemOrdem = {
  id: number;
  descricao: string;
  referencia?: string | null;
  codigo?: string | null;
  unidade?: string | null;
  quantidade: number;
  valorUnitario: number;
  subtotal: number;
};

export type MinhaOrdem = {
  id: number;
  status: string | null;
  prioridade: string | null;
  alvoTipo: string | null;
  dataEntrada: string | null;
  dataSaida: string | null;
  /** `ordemservico.execucao_fim_em` — eixo de período da aba. */
  concluidaEm: string | null;
  subtotal: number;
  valorTotal: number;
  cliente: RelacaoNomeada | null;
  setor: RelacaoNomeada | null;
  veiculo: { id: number; placa: string | null; modelo: string | null; marca: string | null } | null;
  produtos: ItemOrdem[];
  servicos: ItemOrdem[];
};

/** Totais da aba de ordens, sobre todo o período filtrado. */
export type IndicadoresOrdens = {
  ordens: number;
  produtos: number;
  servicos: number;
  servicosComComissao: number;
  total: number;
  parcial: boolean;
};

export type MeuServico = {
  ordemId: number;
  servicoId: number;
  descricao: string;
  codigo: string | null;
  quantidade: number;
  valorUnitario: number;
  subtotal: number;
  observacao: string | null;
  ordem: {
    status: string | null;
    dataEntrada: string | null;
    dataSaida: string | null;
    concluidaEm: string | null;
    cliente: RelacaoNomeada | null;
    setor: RelacaoNomeada | null;
  };
};

export type Paginado<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type Periodo = { de: string; ate: string };

export type AbaCentral = "vendas" | "ordens" | "servicos";
