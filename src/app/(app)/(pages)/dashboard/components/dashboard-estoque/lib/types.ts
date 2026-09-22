export type ProdutoResumo = {
  id: number;
  titulo: string;
  referencia: string | null;
  estoque: number;
  minimo: number;
  custo: number;
  valor: number;
  reposicaoSugerida: number;
};

/** Posição atual do estoque: não tem eixo de tempo e não segue o filtro de período. */
export type DadosEstoque = {
  totais: {
    produtos: number;
    unidades: number;
    valorEstoque: number;
    zerados: number;
    abaixoMinimo: number;
    adequados: number;
    semCusto: number;
  };
  distribuicao: Array<{ nome: string; valor: number; cor: string }>;
  reposicao: ProdutoResumo[];
  maiorValor: ProdutoResumo[];
};

export type OrigemFiltro = "TODAS" | "VENDA" | "OS";
/** "TODOS" ou o id do grupo em texto, porque o valor de um Select é string. */
export type GrupoFiltro = string;
export type MetricaRanking = "QUANTIDADE" | "FATURAMENTO";

export type ValoresPorOrigem = {
  quantidade: number;
  faturamento: number;
};

export type ProdutoVendido = ValoresPorOrigem & {
  produtoId: number;
  titulo: string;
  referencia: string | null;
  unidade: string | null;
  /** `null` quando o produto não tem grupo no cadastro. */
  grupoId: number | null;
  grupoNome: string;
  venda: ValoresPorOrigem;
  os: ValoresPorOrigem;
  documentos: number;
};

export type TotalPorOrigem = ValoresPorOrigem & {
  produtosDistintos: number;
  documentos: number;
};

/** O que sai pela venda de balcão e pela peça cobrada na OS, dentro do período filtrado. */
export type DadosProdutosVendidos = {
  periodo: { inicio: string; fim: string };
  totais: { todas: TotalPorOrigem; venda: TotalPorOrigem; os: TotalPorOrigem };
  ranking: ProdutoVendido[];
  truncado: boolean;
};

export const TOTAIS_VAZIOS: TotalPorOrigem = {
  quantidade: 0,
  faturamento: 0,
  produtosDistintos: 0,
  documentos: 0,
};
