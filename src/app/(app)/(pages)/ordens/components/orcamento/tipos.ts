// src/app/(app)/(pages)/ordens/components/orcamento/tipos.ts
export type ProdutoBusca = {
  id: number;
  codigo: string; // usaremos a referência (referencia) como "código"
  referencia?: string | null;
  etiqueta?: string | null;
  descricao: string;
  precounitario: number; // preço de venda
  estoque: number;
};

export type ServicoBusca = {
  id: number;
  codigo: string;
  referencia?: string | null;
  descricao: string;
  precohora: number;
};

export type TipoDesconto = "FIXO" | "PORCENTAGEM";

export type ItemProduto = {
  produtoid: number;
  descricao: string;
  referencia?: string | null;
  etiqueta?: string | null;
  quantidade: number;
  precounitario: number;
  subtotal: number;
  descontoTipo?: TipoDesconto | null;
  desconto?: number;
};

export type ItemProdutoAvulso = {
  id?: number;
  titulo: string;
  quantidade: number;
  precounitario: number;
  subtotal: number;
  descontoTipo?: TipoDesconto | null;
  desconto?: number;
  descontoInformativoTipo?: TipoDesconto | null;
  descontoInformativo?: number;
};

export type ItemServico = {
  servicoid: number;
  descricao: string;
  referencia?: string | null;
  descricaoServico?: string | null;
  quantidade: number;
  precounitario: number;
  subtotal: number;
  descontoTipo?: TipoDesconto | null;
  desconto?: number;
};

export type OrcamentoFormProps = {
  ordemServico: { id: number; numero?: string; cliente?: string; veiculo?: string };
  onTotaisChange?: (t: {
    subtotal: number;
    totalProdutos: number;
    totalServicos: number;
    desconto: number;
    valorFrete: number;
    totalGeral: number;
  }) => void;
  onLoadingChange?: (loading: boolean) => void;
};

/** Serviço que ficou sem realizador depois de salvar o orçamento. */
export type ServicoSemRealizador = { servicoid: number; descricao: string };

export type ResultadoSalvarOrcamento = {
  servicosSemRealizador: ServicoSemRealizador[];
};

export type OrcamentoFormHandle = {
  salvarOrcamento: (opts?: { baixarEstoque?: boolean }) => Promise<ResultadoSalvarOrcamento>;
};
