// src/app/(app)/(pages)/(financeiro)/dre/types.ts

export type LinhaDre = {
  id: number;
  codigo: string;
  nome: string;
  nivel: number;
  parentId: number | null;
  tipo: "GRUPO" | "DETALHE" | "SUBTOTAL" | "FORMULA";
  naturezaDre: string | null;
  formula: string | null;
  sinal: number;
  semFonte: boolean;
  valor: number;
  valorAnterior: number;
  variacao: number;
  variacaoPercentual: number | null;
  percentualReceitaLiquida: number | null;
  lancamentos: number;
  filhos: LinhaDre[];
};

export type RespostaDre = {
  periodo: { de: string; ate: string; anterior: { de: string; ate: string } };
  template: { id: number; codigo: string; nome: string; versao: number };
  linhas: LinhaDre[];
  indicadores: Record<string, number>;
  /**
   * `null` significa que aquele recorte não pôde ser apurado — diferente de
   * zero. Uma tela que trata os dois igual anuncia "sem pendências" quando o
   * que houve foi uma falha de consulta.
   */
  alertas: {
    lancamentosSemClassificacao: number | null;
    valorSemClassificacao: number | null;
    itensSemCusto: number | null;
    semDespesaOperacional: boolean | null;
    gruposSemDestino: number | null;
    filaIndisponivel: boolean;
  };
  pendencias: {
    indisponivel: boolean;
    itens: number | null;
    valor: number | null;
    porMotivo: PendenciaDre[];
  };
  atualizadoEm: string;
};

export type PendenciaDre = {
  motivo: string;
  descricao: string;
  /** CADASTRO não depende do período; PERIODO e GERAL dependem. */
  escopo: string;
  quantidade: number;
  valor: number | null;
};

export type PeriodoDre = { de: string; ate: string };
