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

export interface TransacaoContexto {
  relacionadas: {
    origem: OrigemRelacionadas;
    itens: LancamentoRelacionado[];
    resumo: ResumoRelacionadas;
  };
  cliente: ClienteContexto | null;
  fornecedor: FornecedorContexto | null;
  vinculo: VinculoContexto | null;
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
  auditoria: {
    created_at: string | null;
    updated_at: string | null;
    criadoPor: Autor;
    alteradoPor: Autor;
    baixadoPor: Autor;
  };
}
