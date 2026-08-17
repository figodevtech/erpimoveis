export type EstadoTokenAprovacao =
  | "INVALIDO"
  | "USADO"
  | "INVALIDADO"
  | "EXPIRADO"
  | "INDISPONIVEL"
  | "VALIDO";

type TokenAprovacao = {
  usado_em?: string | null;
  invalidado_em?: string | null;
  expira_em?: string | null;
} | null;

type VendaEstado = {
  status?: unknown;
  statusaprovacao?: unknown;
} | null;

type Relacao<T> = T | T[] | null | undefined;

type VendaPublicaEntrada = {
  id: unknown;
  descricao?: unknown;
  valor_frete?: unknown;
  desconto_tipo?: unknown;
  desconto_valor?: unknown;
  sub_total?: unknown;
  valortotal?: unknown;
  cliente?: Relacao<{ nomerazaosocial?: unknown }>;
  itens?: Array<{
    id?: unknown;
    quantidade?: unknown;
    sub_total?: unknown;
    valor_total?: unknown;
    tipo_desconto?: unknown;
    valor_desconto?: unknown;
    valor_frete?: unknown;
    produto?: Relacao<{ id?: unknown; titulo?: unknown }>;
  }> | null;
};

export function obterEstadoTokenAprovacao(
  token: TokenAprovacao,
  venda?: VendaEstado,
  agoraMs = Date.now(),
): EstadoTokenAprovacao {
  if (!token) return "INVALIDO";
  if (token.usado_em) return "USADO";
  if (token.invalidado_em) return "INVALIDADO";
  if (!token.expira_em || new Date(token.expira_em).getTime() <= agoraMs) return "EXPIRADO";
  if (
    venda &&
    (String(venda.status).toUpperCase() !== "APROVACAO_ORCAMENTO" ||
      String(venda.statusaprovacao).toUpperCase() !== "PENDENTE")
  ) {
    return "INDISPONIVEL";
  }
  return "VALIDO";
}

export function montarVendaParaAprovacaoPublica(venda: VendaPublicaEntrada) {
  const cliente = Array.isArray(venda.cliente) ? venda.cliente[0] : venda.cliente;
  const itens = (venda.itens ?? []).map((item) => {
    const produto = Array.isArray(item.produto) ? item.produto[0] : item.produto;
    const quantidade = Number(item.quantidade ?? 0);
    const subtotalItem = Number(item.sub_total ?? 0);
    const tipoDesconto = ["FIXO", "PORCENTAGEM"].includes(
      String(item.tipo_desconto ?? "").toUpperCase(),
    )
      ? String(item.tipo_desconto).toUpperCase() as "FIXO" | "PORCENTAGEM"
      : null;
    const valorDesconto = Math.max(0, Number(item.valor_desconto ?? 0));
    const descontoAplicado = tipoDesconto === "PORCENTAGEM"
      ? Math.min(subtotalItem, subtotalItem * (Math.min(valorDesconto, 100) / 100))
      : tipoDesconto === "FIXO"
        ? Math.min(subtotalItem, valorDesconto)
        : 0;
    const frete = Math.max(0, Number(item.valor_frete ?? 0));
    return {
      id: Number(item.id),
      produtoId: Number(produto?.id ?? 0),
      descricao: String(produto?.titulo ?? "Produto"),
      quantidade,
      precoUnitario: subtotalItem / Math.max(quantidade, 1),
      subtotal: subtotalItem,
      desconto: {
        tipo: tipoDesconto,
        valor: tipoDesconto ? valorDesconto : 0,
        aplicado: descontoAplicado,
      },
      frete,
      valorTotal: Number(item.valor_total ?? 0),
    };
  });
  const subtotalProdutos = itens.reduce((sum, item) => sum + item.subtotal, 0);
  const descontoItens = itens.reduce((sum, item) => sum + item.desconto.aplicado, 0);
  const freteItens = itens.reduce((sum, item) => sum + item.frete, 0);
  const tipoDescontoGeral = ["FIXO", "PORCENTAGEM"].includes(
    String(venda.desconto_tipo ?? "").toUpperCase(),
  )
    ? String(venda.desconto_tipo).toUpperCase() as "FIXO" | "PORCENTAGEM"
    : null;
  const valorDescontoGeral = Math.max(0, Number(venda.desconto_valor ?? 0));
  const baseDescontoGeral = Math.max(0, subtotalProdutos - descontoItens);
  const descontoGeralAplicado = tipoDescontoGeral === "PORCENTAGEM"
    ? Math.min(baseDescontoGeral, baseDescontoGeral * (Math.min(valorDescontoGeral, 100) / 100))
    : tipoDescontoGeral === "FIXO"
      ? Math.min(baseDescontoGeral, valorDescontoGeral)
      : 0;
  const freteGeral = Math.max(0, Number(venda.valor_frete ?? 0));
  const total = Math.max(0, Number(venda.valortotal ?? 0));

  return {
    id: Number(venda.id),
    cliente: { nomerazaosocial: String(cliente?.nomerazaosocial ?? "Cliente") },
    descricao: venda.descricao ? String(venda.descricao) : null,
    itens,
    totais: {
      subtotal: subtotalProdutos,
      subtotalProdutos,
      desconto: descontoItens + descontoGeralAplicado,
      descontoItens,
      descontoGeral: {
        tipo: tipoDescontoGeral,
        valor: tipoDescontoGeral ? valorDescontoGeral : 0,
        aplicado: descontoGeralAplicado,
      },
      frete: freteItens + freteGeral,
      freteItens,
      freteGeral,
      total,
    },
  };
}
