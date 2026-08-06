export enum Tipo_transacao {
  RECEITA = "RECEITA",
  DESPESA = "DESPESA",
  DEPOSITO = "DEPOSITO",
  SAQUE = "SAQUE",
}

export interface Categoria_transacao {
  id: number;
  nome: string;
  descricao?: string;
  icone?: string;
  codigo_sistema?: string | null;
  ativo: boolean;
}


export enum Metodo_pagamento {
  PIX = "PIX",
  CREDITO = "CREDITO",
  DEBITO = "DEBITO",
  BOLETO = "BOLETO",
  TRANSFERENCIA = "TRANSFERENCIA",
  TED = "TED",
  DOC = "DOC",
  DINHEIRO = "DINHEIRO",
}

export enum Banco_tipo {
  CORRENTE = "CORRENTE",
  POUPANCA = "POUPANÇA",
  DIGITAL = "DIGITAL",
  PAGAMENTO = "PAGAMENTO",
  SALARIO = "SALÁRIO",
  EMPRESARIAL = "EMPRESARIAL",
}

export interface TransactionCustomer {
  id: number;
  nome: string;
  cpfcnpj: string;
}

/** Fornecedor vinculado a uma transacao (mutuamente exclusivo com o cliente). */
export interface TransactionFornecedor {
  id: number;
  nomerazaosocial?: string | null;
  nomefantasia?: string | null;
  cpfcnpj?: string | null;
}

export interface Banco {
  id: number;
  titulo: string;
  valorinicial: number;
  agencia: string;
  contanumero: string;
  tipo: Banco_tipo;
  proprietario: string;
}

export interface Plano_de_conta {
  id: number;
  codigo?: string | null;
  nome: string;
  descricao?: string | null;
  ativo: boolean;
  grupo_id: number;
  grupo?: Plano_de_conta_grupo | null;
}

export interface Plano_de_conta_grupo {
  id: number;
  codigo: string;
  nome: string;
  descricao?: string | null;
  ativo: boolean;
}

export interface Centro_custo {
  id: number;
  nome: string;
  descricao?: string | null;
  ativo: boolean;
}

export type TransactionRelationFilters = {
  categoriaId: string;
  bancoId: string;
  planoContaId: string;
  centroCustoId: string;
};

/**
 * Visualização do fluxo de caixa.
 * A_PAGAR / A_RECEBER = pendentes; LIQUIDADAS = já baixadas.
 */
export type FluxoViewMode = "TODAS" | "A_RECEBER" | "A_PAGAR" | "LIQUIDADAS";

/**
 * Colunas por onde a listagem pode ser ordenada. Só entram colunas que existem
 * de fato em `transacao` — banco vem de join e o Postgrest não ordena a tabela
 * de cima por coluna de tabela embutida.
 */
export type CampoOrdenacao =
  | "descricao"
  | "competencia_em"
  | "data"
  | "tipo"
  | "categoria"
  | "metodopagamento"
  | "valor";

export type Ordenacao = { campo: CampoOrdenacao; direcao: "asc" | "desc" };

/**
 * Direção do primeiro clique em cada cabeçalho: texto começa em A→Z, data e
 * valor começam pelo mais recente/maior, que é o que se quer ver primeiro.
 */
export const DIRECAO_INICIAL: Record<CampoOrdenacao, "asc" | "desc"> = {
  descricao: "asc",
  tipo: "asc",
  categoria: "asc",
  metodopagamento: "asc",
  competencia_em: "desc",
  data: "desc",
  valor: "desc",
};

export interface Transaction {
  id: number;
  descricao: string;
  /** Texto livre sobre o pagamento; permanece editavel mesmo com a descricao travada por OS/venda. */
  descricao_pagamento?: string | null;
  valor: number;
  valorLiquido: number;
  /** Valor antes dos acréscimos. `valor = valor_base + valor_acrescimos`. */
  valor_base?: number | null;
  /** Soma dos acréscimos lançados na transação (juros, multa). */
  valor_acrescimos?: number | null;
  /** Soma dos descontos lançados, incluindo a taxa de recebimento. */
  valor_descontos?: number | null;
  /** Nas parcelas liquidadas por antecipação, aponta para o adiantamento. */
  adiantamento_id?: number | null;
  /** `true` no lançamento que representa o movimento único da antecipação. */
  eh_adiantamento?: boolean | null;
  data: Date;
  /** Regime de competência: define o período na DRE, ao contrário de `data`, que é de caixa. */
  competencia_em?: string | Date | null;
  metodopagamento: Metodo_pagamento | null;
  categoria: string;
  categoria_id?: number | null;
  categoria_dados?: { id: number; nome: string; icone: string } | null;
  plano_de_conta?: string | null;
  plano_de_conta_id?: number | null;
  plano_de_conta_dados?: { id: number; codigo?: string | null; nome: string } | null;
  centro_custo?: string | null;
  centro_custo_id?: number | null;
  centro_custo_dados?: Centro_custo | null;
  tipo: Tipo_transacao;
  cliente_id?: number;
  fornecedor_id?: number | null;
  fornecedor?: TransactionFornecedor | null;
  banco_id?: number | null;
  banco?: Banco | null;
  parcelas?: number;
  nomepagador?: string;
  cpfcnpjpagador?: string;
  ordemservicoid?: number | null
  vendaid?: number | null
  /** Entrada de estoque/nota de compra que gerou o lançamento. */
  entrada_id?: number | null
  /** Entrada de uso e consumo que gerou o lançamento. */
  usoconsumo_entrada_id?: number | null
  pendente?: boolean
  evento_financeiro_id?: number | null
  is_deleted?: boolean
  /** Usuario que registrou/baixou o pagamento. */
  baixado_por?: string | null
  baixadoPor?: { id: string; nome: string | null } | null
}

export interface NewTransaction {
  id?: number;
  descricao?: string;
  descricao_pagamento?: string | null;
  valor?: number | 0;
  valorLiquido?: number | 0;
  data?: Date;
  metodopagamento?: Metodo_pagamento;
  categoria?: string;
  categoria_id?: number | null;
  plano_de_conta?: string | null;
  plano_de_conta_id?: number | null;
  centro_custo?: string | null;
  centro_custo_id?: number | null;
  tipo?: Tipo_transacao;
  cliente_id?: number | null;
  fornecedor_id?: number | null;
  banco_id?: number | null;
  banco?: Banco | null;
  parcelas?: number;
  ordemservicoid?: number | null
  vendaid?: number | null
  nomepagador?: string;
  cpfcnpjpagador?: string;
  pendente?: boolean
  evento_financeiro_id?: number | null
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  pageCount?: number;
}

export interface StatusInfo {
  mesAtual: {
    somaReceitas: number;
    somaDespesas: number;
    year: number;
    month: number;
  };

  mesAnterior: {
    somaReceitas: number;
    somaDespesas: number;
    year: number;
    month: number;
  };
}
