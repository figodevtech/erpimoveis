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


/**
 * Lista PARCIAL. Não use para montar seletor.
 *
 * A lista de verdade é o enum `metodo_pagamento` do banco, que varia por empresa
 * e cresce sem passar por aqui — o Demir já usa DEBITO AUTOMATICO, CHEQUE e
 * CREDITO EM CONTA, nenhum deles abaixo. Enquanto as telas montavam o seletor a
 * partir deste enum, quem tinha um desses métodos abria a edição e via o campo
 * em branco, sem conseguir escolher o próprio método de volta.
 *
 * Para escolher uma forma de pagamento: `usePaymentMethodOptions()`.
 * Este enum serve só para comparar com um método específico (BOLETO, CREDITO)
 * em regras de parcelamento e taxa.
 */
export enum Metodo_pagamento {
  PIX = "PIX",
  CREDITO = "CREDITO",
  DEBITO = "DEBITO",
  BOLETO = "BOLETO",
  TRANSFERENCIA = "TRANSFERENCIA",
  TED = "TED",
  DOC = "DOC",
  DINHEIRO = "DINHEIRO",
  PERMUTA = "PERMUTA",
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
  metodoPagamento: string;
};

/**
 * Visualização do fluxo de caixa.
 *
 * FLUXO = movimentação bancária de verdade: liquidada **e** com conta. Título
 * quitado por antecipação fica de fora, porque o dinheiro entrou pelo lançamento
 * da antecipação e não por ele — contá-lo aqui dobraria o extrato.
 * A_PAGAR / A_RECEBER = pendentes; LIQUIDADAS = tudo que foi baixado, com conta
 * ou sem.
 */
export type FluxoViewMode = "FLUXO" | "A_RECEBER" | "A_PAGAR" | "LIQUIDADAS";

/**
 * As visualizações e seus rótulos, na ordem em que aparecem.
 *
 * Fonte única: as abas do cabeçalho da tabela e o seletor do painel de filtros
 * mostram a mesma lista. Enquanto cada um tinha a sua cópia, o painel continuou
 * oferecendo "Todas" depois que a visão virou "Fluxo" — e "TODAS" não é um
 * `FluxoViewMode`, então escolher ali deixava a tabela sem aba acesa mostrando
 * um recorte que ninguém pediu.
 */
export const VIEW_MODE_TABS: { value: FluxoViewMode; label: string }[] = [
  { value: "FLUXO", label: "Fluxo" },
  { value: "A_PAGAR", label: "A Pagar" },
  { value: "A_RECEBER", label: "A Receber" },
  { value: "LIQUIDADAS", label: "Liquidadas" },
];

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
  /** Nas parcelas de uma antecipação, aponta para o adiantamento. */
  adiantamento_id?: number | null;
  /** `true` no lançamento que representa o movimento único da antecipação. */
  eh_adiantamento?: boolean | null;
  /**
   * Só na antecipação: `true` quando ela manteve os títulos em aberto para a
   * cobrança acompanhar até o vencimento, em vez de liquidá-los no ato.
   */
  adiantamento_manteve_pendentes?: boolean | null;
  /** Grupo do pagamento múltiplo que originou esta linha, quando houver. */
  pagamento_multiplo_id?: number | null;
  pagamento_multiplo?: {
    id: number;
    descricao: string | null;
    modo: "AVISTA" | "PARCELADO";
    valor_total: number;
    data?: string | null;
  } | null;
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
  // Anulável como `fornecedor_id`: desvincular o cadastro é um estado válido, e
  // a transação segue com o pagador em texto livre.
  cliente_id?: number | null;
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
  /** Documento relacionado ao lançamento — nota, recibo ou comprovante. */
  documento_tipo_id?: number | null
  documento_numero?: string | null
  documento_serie?: string | null
  documento_chave?: string | null
  documento_emitido_em?: string | null
  documento_valor?: number | null
  documento_observacao?: string | null
}

export interface NewTransaction {
  id?: number;
  descricao?: string;
  descricao_pagamento?: string | null;
  valor?: number | 0;
  valorLiquido?: number | 0;
  data?: Date;
  /**
   * A que mês o fato pertence na DRE, ao contrário de `data`, que é de caixa.
   *
   * Só existe em lançamento avulso: quando a transação nasce de uma OS, de uma
   * venda ou da baixa de um evento, a competência é do documento e o servidor
   * recusa recebê-la aqui.
   */
  competencia_em?: Date | null;
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
  /**
   * Documento relacionado ao lançamento — nota, recibo, comprovante.
   *
   * Só o tipo é exigido quando a seção está ligada; o resto é preenchido do
   * jeito que o papel permitir. `documento_emitido_em` vai como `AAAA-MM-DD`,
   * sem hora: data de emissão não tem fuso, e mandar ISO traria de volta o
   * "um dia a menos".
   */
  documento_tipo_id?: number | null
  documento_numero?: string | null
  documento_serie?: string | null
  documento_chave?: string | null
  documento_emitido_em?: string | null
  documento_valor?: number | null
  documento_observacao?: string | null
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
