import { supabaseAdmin } from "@/lib/supabaseAdmin";

const STATUS_VENDA_REALIZADA = new Set(["FINALIZADA", "PAGO"]);

const PECA_SELECT = `
  id,
  lote_id,
  produto_id,
  createdat,
  produto:produto_id (
    id,
    titulo,
    referencia,
    fabricante,
    estoque,
    precovenda,
    conservacao,
    status_estoque,
    "imgUrl"
  )
`;

type VendaProdutoRow = {
  id: number;
  venda_id: number;
  produtoid: number;
  quantidade: number | null;
  valor_total: number | null;
  sub_total: number | null;
  venda: { id?: number; status?: string | null } | { id?: number; status?: string | null }[] | null;
};

function primeiro<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function numero(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function carregarResumoPecasLote(loteId: number, valorCompraInformado?: number | null) {
  let valorCompra = numero(valorCompraInformado);

  if (valorCompraInformado === undefined) {
    const { data: lote, error: loteError } = await supabaseAdmin
      .from("lotes")
      .select("valor_compra")
      .eq("id", loteId)
      .single();

    if (loteError) throw loteError;
    valorCompra = numero(lote?.valor_compra);
  }

  const { data: relacoes, error: relacoesError } = await supabaseAdmin
    .from("lote_pecas")
    .select(PECA_SELECT)
    .eq("lote_id", loteId)
    .order("id", { ascending: false });

  if (relacoesError) throw relacoesError;

  const pecasBase = (relacoes ?? []).map((relacao: any) => ({
    ...relacao,
    produto: primeiro(relacao.produto),
  }));
  const produtoIds = pecasBase
    .map((peca) => Number(peca.produto_id))
    .filter((id) => Number.isInteger(id) && id > 0);

  const vendasPorProduto = new Map<
    number,
    { quantidade: number; valor: number; vendas: Set<number> }
  >();

  if (produtoIds.length > 0) {
    const { data: itensVenda, error: itensVendaError } = await supabaseAdmin
      .from("vendaproduto")
      .select("id, venda_id, produtoid, quantidade, valor_total, sub_total, venda:venda_id(id, status)")
      .in("produtoid", produtoIds);

    if (itensVendaError) throw itensVendaError;

    for (const item of (itensVenda ?? []) as unknown as VendaProdutoRow[]) {
      const venda = primeiro(item.venda);
      const status = String(venda?.status ?? "").toUpperCase();
      if (!STATUS_VENDA_REALIZADA.has(status)) continue;

      const produtoId = Number(item.produtoid);
      const atual = vendasPorProduto.get(produtoId) ?? {
        quantidade: 0,
        valor: 0,
        vendas: new Set<number>(),
      };
      atual.quantidade += numero(item.quantidade);
      atual.valor += numero(item.valor_total ?? item.sub_total);
      atual.vendas.add(Number(item.venda_id));
      vendasPorProduto.set(produtoId, atual);
    }
  }

  const pecas = pecasBase.map((peca) => {
    const vendas = vendasPorProduto.get(Number(peca.produto_id));
    return {
      ...peca,
      quantidade_vendida: vendas?.quantidade ?? 0,
      valor_apurado: vendas?.valor ?? 0,
      vendas_realizadas: vendas?.vendas.size ?? 0,
    };
  });

  const valorPecas = pecas.reduce(
    (total, peca) => total + numero(peca.produto?.precovenda),
    0,
  );
  const valorApurado = pecas.reduce(
    (total, peca) => total + numero(peca.valor_apurado),
    0,
  );
  const valorDisponivel = pecas.reduce(
    (total, peca) =>
      total + (numero(peca.quantidade_vendida) > 0 ? 0 : numero(peca.produto?.precovenda)),
    0,
  );
  const quantidadeVendida = pecas.reduce(
    (total, peca) => total + numero(peca.quantidade_vendida),
    0,
  );
  const pecasVendidas = pecas.filter((peca) => numero(peca.quantidade_vendida) > 0).length;

  return {
    pecas,
    pecasKpis: {
      totalPecas: pecas.length,
      pecasVendidas,
      quantidadeVendida,
      valorCompra,
      valorPecas,
      valorApurado,
      valorDisponivel,
      resultadoApurado: valorApurado - valorCompra,
      resultadoPotencial: valorApurado + valorDisponivel - valorCompra,
    },
  };
}
