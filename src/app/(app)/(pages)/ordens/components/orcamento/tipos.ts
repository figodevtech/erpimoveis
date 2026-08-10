// src/app/(app)/(pages)/ordens/components/orcamento/tipos.ts
export type ProdutoBusca = {
  id: number;
  codigo: string; // usaremos a referência (referencia) como "código"
  descricao: string;
  precounitario: number; // preço de venda
  estoque: number;
};

export type ServicoBusca = {
  id: number;
  codigo: string;
  descricao: string;
  precohora: number;
};

export type TipoDesconto = "FIXO" | "PORCENTAGEM";

export type ItemProduto = {
  produtoid: number;
  descricao: string;
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
};

export type ItemServico = {
  servicoid: number;
  descricao: string;
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

export type OrcamentoFormHandle = {
  salvarOrcamento: (opts?: { baixarEstoque?: boolean }) => Promise<void>;
};
