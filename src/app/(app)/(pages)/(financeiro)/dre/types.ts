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
  /**
   * Estado da apuração. Em `LEGADO` a soma resolve pelo mapeamento de grupo e
   * ignora a classificação da conta — classificar pela fila não move o total, e
   * a tela precisa dizer isso antes. `null` significa que não foi possível ler.
   */
  implantacao: {
    estado: "LEGADO" | "PREPARACAO" | "ATIVO" | null;
    vigenciaInicio: string | null;
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

/**
 * Um item de uma pendência, como `dre_pendencias_itens` devolve.
 *
 * `referenciaTipo` é o que decide qual formulário de correção abrir: GRUPO e
 * CONTA vão para a classificação do cadastro, TRANSACAO para o diálogo do
 * financeiro, EVENTO para a correção do lançamento.
 */
export type ItemPendencia = {
  referencia_tipo: "GRUPO" | "CONTA" | "TRANSACAO" | "EVENTO";
  referencia_id: number;
  descricao: string | null;
  grupo: string | null;
  conta: string | null;
  competencia: string | null;
  valor: number | null;
};
