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
  alertas: {
    lancamentosSemClassificacao: number;
    itensSemCusto: number;
    semDespesaOperacional: boolean;
  };
  atualizadoEm: string;
};

export type PeriodoDre = { de: string; ate: string };
