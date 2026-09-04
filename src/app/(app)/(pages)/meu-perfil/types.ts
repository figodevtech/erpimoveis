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
  subdescricao: string | null;
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
  /** O que coube a quem abriu esta OS. Zero quando não há comissão de criação. */
  comissaoCriacao: number;
};

/**
 * Totais da aba de vendas, sobre todo o período filtrado.
 *
 * As parcelas fecham: `produtos − descontos + frete = total`. Elas existem
 * separadas porque a soma dos produtos vendidos não é o valor das vendas
 * quando há frete ou desconto no meio.
 */
export type IndicadoresVendas = {
  vendas: number;
  /** Soma dos itens, antes de desconto e frete. */
  produtos: number;
  frete: number;
  descontos: number;
  /** `venda.valortotal` — o valor fechado da venda. */
  total: number;
  parcial: boolean;
};

/** Totais da aba de ordens, sobre todo o período filtrado. */
export type IndicadoresOrdens = {
  ordens: number;
  produtos: number;
  servicos: number;
  servicosComComissao: number;
  /** O que coube a quem abriu a ordem. Zero quando o usuário não recebe por criação. */
  comissaoCriacao: number;
  total: number;
  parcial: boolean;
};

/** Quem executou um servico, e o que coube a cada um. */
export type RealizadorDoServico = {
  usuarioId: string;
  nome: string;
  /** Fatia do valor do servico atribuida a esta pessoa. */
  valorBase: number;
  valorComissao: number;
  euMesmo: boolean;
};

export type MeuServico = {
  ordemId: number;
  servicoId: number;
  descricao: string;
  subdescricao: string | null;
  codigo: string | null;
  /** `servico.gera_comissao` do cadastro, como esta hoje. */
  geraComissao: boolean;
  quantidade: number;
  valorUnitario: number;
  subtotal: number;
  observacao: string | null;
  /** A fatia e a comissao desta pessoa, como gravadas. */
  valorBase: number;
  valorComissao: number;
  /** Todos os executores do servico — mais de um significa trabalho dividido. */
  realizadores: RealizadorDoServico[];
  ordem: {
    status: string | null;
    dataEntrada: string | null;
    dataSaida: string | null;
    concluidaEm: string | null;
    cliente: RelacaoNomeada | null;
    setor: RelacaoNomeada | null;
  };
};

/**
 * Totais da aba de servicos realizados, sobre todo o periodo filtrado.
 *
 * Os valores somam o subtotal cheio do servico — o mesmo numero que a coluna
 * "Valor" da lista mostra —, entao o card e a tabela fecham igual. Servico
 * dividido com outro realizador entra inteiro para os dois.
 */
export type IndicadoresServicos = {
  servicos: number;
  valorTotal: number;
  /** Quanto desse valor vem de servicos marcados como "gera comissao". */
  valorComComissao: number;
  /** Comissao do usuario no periodo, somada do que esta gravado em cada vinculo. */
  comissao: number;
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

export type AbaCentral = "vendas" | "ordens" | "servicos";
