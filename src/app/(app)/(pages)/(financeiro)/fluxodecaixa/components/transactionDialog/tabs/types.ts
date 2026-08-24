/** O título que esta linha pagou, quando ela é a transação de uma baixa. */
export type BaixaDeTitulo = {
  id: number;
  descricao: string | null;
  valor: number;
  valorLiquido: number;
  valorBaixado: number;
  pendente: boolean;
  vencimentoEm: string | null;
  /** O título veio de uma antecipação: aqui a linha é repasse, não quitação. */
  antecipado: boolean;
};

/** Formato devolvido por GET /api/transaction/[id]/contexto. */

export type Autor = { id: string; nome: string | null } | null;

export type OrigemRelacionadas = "OS" | "VENDA" | "PARCELAMENTO" | "NENHUM";

export interface LancamentoRelacionado {
  id: number;
  descricao: string;
  descricao_pagamento?: string | null;
  valor: number | string | null;
  valorLiquido?: number | string | null;
  data: string | null;
  vencimento_em?: string | null;
  pago_em?: string | null;
  pendente: boolean;
  tipo: string;
  metodopagamento?: string | null;
  banco?: { id: number; titulo: string } | null;
  contaParaTotal: boolean;
  baixadoPor: Autor;
}

export interface ResumoRelacionadas {
  /** Total do documento de origem. `null` em parcelamento avulso. */
  totalDevido: number | null;
  pago: number;
  pendente: number;
  lancado: number;
  /** Quanto falta para quitar. `null` quando nao ha documento de origem. */
  restante: number | null;
}

export interface ClienteContexto {
  id: number;
  nomerazaosocial: string | null;
  cpfcnpj: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
  endereconumero: string | null;
  enderecocomplemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
}

export interface FornecedorContexto {
  id: number;
  nomerazaosocial: string | null;
  nomefantasia: string | null;
  cpfcnpj: string | null;
  contato: string | null;
  endereco: string | null;
  endereconumero: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
}

export interface VinculoContexto {
  tipo: "OS" | "VENDA";
  id: number;
  status: string | null;
  total: number;
  href: string;
  descricao?: string | null;
  dataentrada?: string | null;
  datasaida?: string | null;
  datavenda?: string | null;
  veiculo?: { nome: string | null; placa: string | null } | null;
}

/**
 * O grupo de um pagamento múltiplo visto de dentro de uma de suas transações.
 *
 * `documentos` é o rateio DESTE lançamento — no parcelado, o que esta parcela
 * abate de cada documento; à vista, o rateio inteiro, já que o grupo tem uma
 * transação só.
 */
export interface PagamentoMultiploContexto {
  id: number;
  descricao: string | null;
  modo: string;
  tipoDocumento: "OS" | "VENDA";
  valorTotal: number;
  data: string | null;
  parcelas: number;
  valorDesteLancamento: number;
  documentos: Array<{
    tipo: "OS" | "VENDA";
    id: number;
    valor: number;
    href: string;
  }>;
}

/** Uma linha de `transacao_valor_historico`: quem mexeu no valor, e para quanto. */
export interface AjusteDeValor {
  id: number;
  valor_anterior: number | string;
  valor_novo: number | string;
  valor_liquido_anterior: number | string | null;
  valor_liquido_novo: number | string | null;
  motivo: string | null;
  created_at: string | null;
  alteradoPor: Autor;
}

/**
 * Uma troca de pagador/recebedor.
 *
 * Guarda os ids e o texto do momento: o cadastro pode ser renomeado ou excluído
 * depois, e sem o instantâneo o histórico viraria uma linha de números.
 */
export interface TrocaDeContraparte {
  id: number;
  cliente_anterior_id: number | null;
  cliente_novo_id: number | null;
  fornecedor_anterior_id: number | null;
  fornecedor_novo_id: number | null;
  nome_anterior: string | null;
  nome_novo: string | null;
  documento_anterior: string | null;
  documento_novo: string | null;
  created_at: string | null;
  alteradoPor: Autor;
}

/**
 * A transferência de que esta linha é uma das pernas.
 *
 * Diferente de `BaixaDeTitulo`: lá a linha paga alguma coisa, aqui ela e a
 * gêmea são o mesmo dinheiro visto de duas contas.
 */
export interface TransferenciaContexto {
  id: number;
  valor: number;
  origem: string | null;
  destino: string | null;
  sentido: "SAIDA" | "ENTRADA";
  contraparteId: number | null;
}

export interface TransacaoContexto {
  /** Preenchido só quando esta transação é o dinheiro da baixa de um título. */
  baixaDe?: BaixaDeTitulo | null;
  /** Preenchido só nas duas pernas de uma transferência entre contas. */
  transferencia?: TransferenciaContexto | null;
  relacionadas: {
    origem: OrigemRelacionadas;
    itens: LancamentoRelacionado[];
    resumo: ResumoRelacionadas;
  };
  cliente: ClienteContexto | null;
  fornecedor: FornecedorContexto | null;
  vinculo: VinculoContexto | null;
  /**
   * Como esta transação aparece na DRE.
   *
   * `DIRETO`: ela é o próprio fato econômico (lançamento avulso classificado, ou
   * despesa de OS/venda que virou transação). O valor dela é o valor na linha.
   *
   * `DOCUMENTO`: ela só liquida OS/venda. O valor dela **não** aparece na DRE —
   * aparecem os lançamentos de cada documento, com o valor deles e na
   * competência deles. É o caso de um recebimento que baixa várias OS de uma vez.
   *
   * `papel` nulo com `linhas` vazio: a transação não toca a DRE (transferência,
   * saque, compra que vira estoque, ou lançamento sem classificação).
   */
  dre: {
    papel: "DIRETO" | "DOCUMENTO" | null;
    linhas: Array<{
      documentoTipo: "OS" | "VENDA" | null;
      documentoId: number | null;
      codigo: string;
      nome: string;
      naturezaDre: string | null;
      valor: number;
    }>;
  };
  /**
   * O grupo do parcelamento avulso. `null` quando a transação é à vista, quando
   * as parcelas pertencem a um documento, ou quando o grupo é antigo demais para
   * ter ganhado identidade — nesse último caso a aba Parcelas ainda lista as
   * irmãs pela heurística, mas não oferece o reparcelamento.
   */
  parcelamento: { id: number } | null;
  /** Presente só quando a transação faz parte de um pagamento múltiplo. */
  pagamentoMultiplo: PagamentoMultiploContexto | null;
  baixa: {
    vencimento_em: string | null;
    pago_em: string | null;
    banco_id: number | null;
    metodopagamento: string | null;
    created_at: string | null;
    baixadoPor: Autor;
  } | null;
  /** Mais recente primeiro. Vazio quando o valor nunca foi ajustado. */
  ajustes: AjusteDeValor[];
  /** Mais recente primeiro. Vazio quando o pagador nunca foi trocado. */
  contraparte: TrocaDeContraparte[];
  auditoria: {
    created_at: string | null;
    updated_at: string | null;
    criadoPor: Autor;
    alteradoPor: Autor;
    baixadoPor: Autor;
  };
}
