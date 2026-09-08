/** O que a tela de conciliação recebe das rotas e devolve para elas. */

export type SituacaoMovimento =
  | "MATCH_EXATO"
  | "MATCH_PROVAVEL"
  | "AMBIGUO"
  | "SEM_CORRESPONDENCIA"
  | "REVISAO_MANUAL";

export type AcaoConciliacao = "VINCULAR" | "LIQUIDAR" | "BAIXA_PARCIAL" | "CRIAR" | "IGNORAR";

export interface SugestaoMatch {
  transacaoId: number;
  origem: "FLUXO" | "TITULO";
  score: number;
  diferencaEmDias: number;
  parcial: boolean;
  valorCentavos: number;
  descricao: string;
  tipo: string;
  data: string;
  metodopagamento: string | null;
  contraparte: string | null;
  ordemservicoid: number | null;
  vendaid: number | null;
}

export interface AnaliseDeMovimento {
  situacao: SituacaoMovimento;
  score: number;
  sugestoes: SugestaoMatch[];
  acaoSugerida: AcaoConciliacao | null;
  observacao: string | null;
}

export interface MovimentoAnalisado {
  sequencia: number;
  tipoOfx: string | null;
  dataPostagem: string;
  dataDisponivel: string | null;
  valorCentavos: number;
  fitid: string | null;
  checknum: string | null;
  refnum: string | null;
  nome: string | null;
  memo: string | null;
  fingerprint: string;
  analise: AnaliseDeMovimento;
  metodoSugerido: string | null;
  jaImportado: boolean;
  movimentoId: number | null;
  statusGravado: string | null;
}

export interface ContaBancaria {
  id: number;
  titulo: string;
  agencia: string | null;
  contanumero: string | null;
  tipo: string | null;
}

export interface ResumoDoExtrato {
  quantidade: number;
  creditos: number;
  debitos: number;
  totalCreditosCentavos: number;
  totalDebitosCentavos: number;
  encontrados: number;
  provaveis: number;
  ambiguos: number;
  novos: number;
  revisaoManual: number;
  jaImportados: number;
}

export interface PreviewDoExtrato {
  arquivo: {
    nome: string;
    hash: string;
    jaImportado: { id: number; arquivo_nome: string; created_at: string } | null;
  };
  conta: ContaBancaria;
  contaSugerida: ContaBancaria | null;
  divergenciaDeConta: string | null;
  cabecalho: {
    bankId: string | null;
    branchId: string | null;
    acctId: string | null;
    acctType: string | null;
    moeda: string | null;
    periodoInicio: string | null;
    periodoFim: string | null;
    saldoInicial: number | null;
    saldoFinal: number | null;
  };
  resumo: ResumoDoExtrato;
  movimentos: MovimentoAnalisado[];
}

/** A decisão do usuário sobre uma linha. `null` deixa o movimento em aberto. */
export interface Decisao {
  fingerprint: string;
  movimentoId?: number;
  acao: "VINCULAR" | "LIQUIDAR" | "CRIAR" | "IGNORAR";
  transacaoId?: number | null;
  valor?: number | null;
  metodopagamento?: string | null;
  planoContaId?: number | null;
  centroCustoId?: number | null;
  nova?: {
    descricao?: string | null;
    tipo?: string | null;
    categoria?: string | null;
    categoria_id?: number | null;
    plano_de_conta_id?: number | null;
    centro_custo_id?: number | null;
  } | null;
  observacao?: string | null;
}

export interface ImportacaoResumida {
  id: number;
  banco_id: number;
  arquivo_nome: string;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  quantidade_movimentos: number;
  quantidade_importados: number;
  quantidade_repetidos: number;
  created_at: string;
  usuario: string | null;
  banco: { id: number; titulo: string } | null;
  situacoes: { conciliados: number; pendentes: number; ignorados: number };
}

export interface MovimentoGravado {
  id: number;
  sequencia: number;
  fitid: string | null;
  checknum: string | null;
  refnum: string | null;
  tipo_ofx: string | null;
  data_postagem: string;
  valor: number | string;
  valor_centavos: number | string;
  nome: string | null;
  memo: string | null;
  fingerprint: string;
  status: string;
  situacao_analise: string | null;
  score_match: number | null;
  acao_conciliacao: string | null;
  observacao: string | null;
  transacao_id: number | null;
  titulo_origem_id: number | null;
  conciliado_em: string | null;
  analise: AnaliseDeMovimento;
  metodoSugerido: string | null;
}

/** Cores e rótulos de cada situação, num lugar só. */
export const APARENCIA_DA_SITUACAO: Record<
  SituacaoMovimento,
  { rotulo: string; classe: string }
> = {
  MATCH_EXATO: {
    rotulo: "Já no fluxo",
    classe:
      "border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
  },
  MATCH_PROVAVEL: {
    rotulo: "Provável",
    classe: "border-amber-600/40 bg-amber-600/10 text-amber-700 dark:text-amber-400",
  },
  AMBIGUO: {
    rotulo: "Ambíguo",
    classe: "border-orange-600/40 bg-orange-600/10 text-orange-700 dark:text-orange-400",
  },
  SEM_CORRESPONDENCIA: {
    rotulo: "Não encontrado",
    classe: "border-slate-500/40 bg-slate-500/10 text-slate-600 dark:text-slate-400",
  },
  REVISAO_MANUAL: {
    rotulo: "Revisão manual",
    classe: "border-violet-600/40 bg-violet-600/10 text-violet-700 dark:text-violet-400",
  },
};

export const ROTULO_DA_ACAO: Record<AcaoConciliacao, string> = {
  VINCULAR: "Vincular ao movimento existente",
  LIQUIDAR: "Dar baixa no título",
  BAIXA_PARCIAL: "Dar baixa parcial no título",
  CRIAR: "Criar transação",
  IGNORAR: "Ignorar movimento",
};

/** Reais a partir dos centavos que a API devolve. */
export function reais(centavos: number): number {
  return centavos / 100;
}
