import { Transaction } from "../../(pages)/(financeiro)/fluxodecaixa/types";

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

}

export type Equipamento = {
  nome: string;
  patrimonio?: string | null;
  ano?: number | null;
  horimetro?: number | null;
};

export type OrdemRoot = {
  id: number;
  numero?: string;
  status?: StatusOS | null;
  setor?: { id: number; nome: string } | null;
  responsavel?: { id: number; nome: string } | null;
  tecnicoid?: string | null; // se mantiver
  descricao?: string | null;
  observacoes?: string | null;
  cliente?: Cliente | null;
  veiculo?: Veiculo | null;
  peca?: Peca | null
  equipamento?: Equipamento | null;
  checklistTemplateId?: string | null;
  orcamentototal:number;
  transacoes: Transaction[] | null
  is_deleted?: boolean
  createdAt?: Date
  alvo_tipo?: "VEICULO" | "PECA" | "EQUIPAMENTO" | null
  execucao_inicio_em?: Date | null
  execucao_fim_em?: Date | null
};

export type OrcamentoTotais = {
  totalProdutos: number;
  totalServicos: number;
  totalGeral: number;
};
