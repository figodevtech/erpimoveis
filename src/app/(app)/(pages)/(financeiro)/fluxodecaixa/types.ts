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

export interface Banco {
  id: number;
  titulo: string;
  valorinicial: number;
  agencia: string;
  contanumero: string;
  tipo: Banco_tipo;
  proprietario: string;
}

export interface Transaction {
  id: number;
  descricao: string;
  valor: number;
  valorLiquido: number;
  data: Date;
  metodopagamento: Metodo_pagamento;
  categoria: string;
  categoria_id?: number | null;
  categoria_dados?: { id: number; nome: string; icone: string } | null;
  tipo: Tipo_transacao;
  cliente_id?: number;
  banco_id?: number | null;
  banco?: Banco | null;
  parcelas?: number;
  nomepagador?: string;
  cpfcnpjpagador?: string;
  ordemservicoid?: number | null
  vendaid?: number | null
  pendente?: boolean


}
export interface NewTransaction {
  id?: number;
  descricao?: string;
  valor?: number | 0;
  valorLiquido?: number | 0;
  data?: Date;
  metodopagamento?: Metodo_pagamento;
  categoria?: string;
  categoria_id?: number | null;
  tipo?: Tipo_transacao;
  cliente_id?: number | null;
  banco_id?: number | null;
  banco?: Banco | null;
  parcelas?: number;
  ordemservicoid?: number | null
  vendaid?: number | null
  nomepagador?: string;
  cpfcnpjpagador?: string;
  pendente?: boolean
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
