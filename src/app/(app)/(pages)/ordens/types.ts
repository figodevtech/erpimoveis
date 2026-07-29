import { Transaction } from "../(financeiro)/fluxodecaixa/types";
import type { PlannedPayment } from "@/lib/payment-methods";

export type ID = number | string;

export type StatusOS =
  | "TODAS"
  | "ORCAMENTO"
  | "APROVACAO_ORCAMENTO"
  | "ORCAMENTO_APROVADO"
  | "ORCAMENTO_RECUSADO"
  | "EM_ANDAMENTO"
  | "PAGAMENTO"
  | "SEM_COBRANCA"
  | "CONCLUIDO"
  | "CANCELADO"
  | "AGUARDANDO_CHECKLIST"

export type Cliente = {
  id: number;
  nome: string;
  nomerazaosocial?: string | null;
  telefone?: string | null;
  email?: string | null;
  documento?: string | null; // CPF/CNPJ
};

export type Veiculo = {
  id: number;
  placa: string;
  modelo: string;
  marca?: string;
  ano?: number | null;
  clienteid?: number;
};

export type Peca = {
  id: number;
  titulo: string;
  descricao: string;
  lacre?: string | null;
}

export type Equipamento = {
  nome: string;
  patrimonio?: string | null;
  ano?: number | null;
  horimetro?: number | null;
};

export type Ordem = {
  id: number;
  numero?: string;
  notaNumero?: number | null;
  status?: StatusOS | null;
  usuariocriadorid?: string | null;
  criador?: { id: string; nome?: string | null } | null;
  setor?: { id: number; nome: string } | null;
  responsavel?: { id: number; nome: string } | null;
  tecnicoid?: string | null; // se mantiver
  descricao?: string | null;
  observacoes?: string | null;
  observacoes_fiscais?: string | null;
  forma_pagamento?: string | null;
  parcelas_pagamento?: number | null;
  pagamentos_previstos?: PlannedPayment[] | null;
  descricao_financeiro?: string | null;
  garantia?: string | null;
  cliente?: Cliente | null;
  veiculo?: Veiculo | null;
  peca?: Peca | null
  equipamento?: Equipamento | null;
  checklistTemplateId?: string | null;
  orcamentototal:number;
  subtotal?: number | null;
  desconto_tipo?: "FIXO" | "PORCENTAGEM" | null;
  desconto?: number | null;
  acrescimo_financeiro_tipo?: "FIXO" | "PORCENTAGEM" | null;
  acrescimo_financeiro_valor?: number | null;
  transacoes: Transaction[] | null
  is_deleted?: boolean
  created_at?: Date
  alvo_tipo?: "VEICULO" | "PECA" | "EQUIPAMENTO" | null
};

export type OrcamentoTotais = {
  totalProdutos: number;
  totalServicos: number;
  totalGeral: number;
};
