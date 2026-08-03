export type TipoDesconto = "FIXO" | "PORCENTAGEM" | null;

/** Linha de produto ou serviço do orçamento, como devolvida por /api/ordens/aprovacao/[token]. */
export type LinhaOrcamento = {
  descricao: string;
  quantidade: number;
  precounitario: number;
  /** quantidade x preço unitário, antes do desconto do item */
  valorBruto: number;
  descontoTipo: TipoDesconto;
  /** valor informado no cadastro: reais quando FIXO, percentual quando PORCENTAGEM */
  desconto: number;
  /** quanto o desconto do item representa em reais */
  descontoAplicado: number;
  /** valorBruto - descontoAplicado */
  subtotal: number;
};

export type TotaisOrcamento = {
  totalProdutos: number;
  totalServicos: number;
  subtotal: number;
  descontoGeralTipo: TipoDesconto;
  descontoGeralInformado: number;
  descontoGeral: number;
  totalGeral: number;
};

export const money = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(valor) || 0);

/** Percentual sem casas decimais desnecessárias: 10 vira "10", 7.5 vira "7,5". */
export const percent = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(Number(valor) || 0);
