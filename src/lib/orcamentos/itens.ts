// Normalizacao e totais do orcamento avulso.
//
// Mesmas regras de desconto da OS (@/lib/ordens/desconto): desconto por item
// sobre quantidade x preco, e desconto geral sobre a soma dos subtotais. O que
// nao existe aqui e o acrescimo financeiro — orcamento nao tem forma de
// pagamento — nem qualquer nocao de estoque.

import {
  arredondarMoeda,
  calcularTotalComDesconto,
  sanitizeTipoDesconto,
  type TipoDesconto,
} from "@/lib/ordens/desconto";
import { calcularTotaisOs, sanitizarValorFrete } from "@/lib/ordens/totais";
import { normalizarDescontoInformativo } from "@/lib/ordens/desconto-informativo";

export const toNum = (value: unknown): number => {
  const numero = Number(value);
  return Number.isFinite(numero) ? numero : 0;
};

/** Trava o desconto na base: % nunca passa de 100, R$ nunca passa do valor bruto. */
export function limitarDesconto(base: number, tipo: TipoDesconto, desconto: unknown) {
  const valor = Math.max(0, toNum(desconto));
  if (tipo === "PORCENTAGEM") return Math.min(valor, 100);
  if (tipo === "FIXO") return Math.min(valor, Math.max(0, toNum(base)));
  return 0;
}

export type ProdutoEntrada = {
  produtoid: unknown;
  quantidade: unknown;
  precounitario: unknown;
  descontoTipo?: unknown;
  desconto?: unknown;
};

export type ServicoEntrada = {
  servicoid: unknown;
  descricao?: unknown;
  quantidade: unknown;
  precounitario: unknown;
  descontoTipo?: unknown;
  desconto?: unknown;
};

export type AvulsoEntrada = {
  titulo: unknown;
  quantidade: unknown;
  precounitario: unknown;
  descontoTipo?: unknown;
  desconto?: unknown;
  descontoInformativoTipo?: unknown;
  descontoInformativo?: unknown;
};

export type ItensNormalizados = ReturnType<typeof normalizarItens>;

export class OrcamentoInvalidoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrcamentoInvalidoError";
  }
}

function normalizarLinha(quantidade: unknown, precounitario: unknown, descontoTipo: unknown, desconto: unknown) {
  const qtd = Math.max(0, toNum(quantidade));
  const preco = Math.max(0, toNum(precounitario));
  const tipo = sanitizeTipoDesconto(descontoTipo);
  const valorDesconto = limitarDesconto(qtd * preco, tipo, desconto);

  return {
    quantidade: qtd,
    precounitario: preco,
    desconto_tipo: tipo,
    desconto: valorDesconto,
    subtotal: calcularTotalComDesconto(qtd * preco, tipo, valorDesconto),
  };
}

/**
 * Converte o corpo cru da requisicao nas linhas que vao para o banco e nos
 * totais do cabecalho. Itens com quantidade zero somem — e assim que a tela
 * remove um item do carrinho.
 */
export function normalizarItens(body: {
  produtos?: unknown;
  servicos?: unknown;
  produtosAvulsos?: unknown;
  descontoTipo?: unknown;
  desconto?: unknown;
  valorFrete?: unknown;
}) {
  const produtosBody: ProdutoEntrada[] = Array.isArray(body?.produtos) ? body.produtos : [];
  const servicosBody: ServicoEntrada[] = Array.isArray(body?.servicos) ? body.servicos : [];
  const avulsosBody: AvulsoEntrada[] = Array.isArray(body?.produtosAvulsos) ? body.produtosAvulsos : [];

  const produtos = produtosBody
    .map((item) => ({
      produtoid: Math.trunc(toNum(item.produtoid)),
      ...normalizarLinha(item.quantidade, item.precounitario, item.descontoTipo, item.desconto),
    }))
    .filter((item) => item.produtoid > 0 && item.quantidade > 0);

  const servicos = servicosBody
    .map((item) => ({
      servicoid: Math.trunc(toNum(item.servicoid)),
      descricao: item.descricao ? String(item.descricao).trim() || null : null,
      ...normalizarLinha(item.quantidade, item.precounitario, item.descontoTipo, item.desconto),
    }))
    .filter((item) => item.servicoid > 0 && item.quantidade > 0);

  const produtosAvulsos = avulsosBody.map((item) => {
    const informativo = normalizarDescontoInformativo(item.descontoInformativoTipo, item.descontoInformativo);
    return {
      titulo: String(item.titulo ?? "").trim(),
      desconto_informativo_tipo: informativo.descontoInformativoTipo,
      desconto_informativo: informativo.descontoInformativo,
      ...normalizarLinha(
        Math.trunc(toNum(item.quantidade)),
        item.precounitario,
        item.descontoTipo,
        item.desconto,
      ),
    };
  });

  if (produtosAvulsos.some((item) => !item.titulo || item.quantidade < 1 || item.precounitario <= 0)) {
    throw new OrcamentoInvalidoError(
      "Informe título, quantidade e valor maior que zero para cada produto avulso.",
    );
  }

  // A PK de orcamento_produto/_servico e (orcamentoid, item): item repetido
  // quebraria o insert com erro cru de banco, entao barramos com mensagem util.
  const produtosDuplicados = produtos.length !== new Set(produtos.map((p) => p.produtoid)).size;
  const servicosDuplicados = servicos.length !== new Set(servicos.map((s) => s.servicoid)).size;
  if (produtosDuplicados || servicosDuplicados) {
    throw new OrcamentoInvalidoError(
      "Há itens repetidos no orçamento. Some as quantidades em uma única linha.",
    );
  }

  const subtotal = arredondarMoeda(
    [...produtos, ...servicos, ...produtosAvulsos].reduce((acc, item) => acc + item.subtotal, 0),
  );

  const descontoTipo = sanitizeTipoDesconto(body?.descontoTipo);
  const desconto = limitarDesconto(subtotal, descontoTipo, body?.desconto);
  const valorFrete = sanitizarValorFrete(body?.valorFrete);

  // Reaproveita a regra de totais da OS para o orcamento nao divergir dela:
  // itens - desconto + frete. Sem acrescimo financeiro.
  const totais = calcularTotaisOs({ subtotal, descontoTipo, desconto, valorFrete });

  return {
    produtos,
    servicos,
    produtosAvulsos,
    cabecalho: {
      subtotal,
      desconto_tipo: descontoTipo,
      desconto,
      valor_frete: totais.valorFrete,
      total: totais.totalComercial,
    },
  };
}
