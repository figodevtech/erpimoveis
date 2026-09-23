// Gravacao dos itens do orcamento.
//
// Diferente do orcamento da OS, aqui a estrategia e apagar e reinserir. La o
// diff item a item existe porque cada linha pode ter reservado estoque e o
// delta precisa ser devolvido ao saldo; orcamento nao toca estoque, entao nao
// ha nada a reconciliar e o caminho simples e o correto.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { ItensNormalizados } from "./itens";

export async function gravarItensDoOrcamento(orcamentoId: number, itens: ItensNormalizados) {
  const limpeza = await Promise.all([
    supabaseAdmin.from("orcamento_produto").delete().eq("orcamentoid", orcamentoId),
    supabaseAdmin.from("orcamento_servico").delete().eq("orcamentoid", orcamentoId),
    supabaseAdmin.from("orcamento_produto_avulso").delete().eq("orcamentoid", orcamentoId),
  ]);
  for (const resultado of limpeza) {
    if (resultado.error) throw resultado.error;
  }

  if (itens.produtos.length) {
    const { error } = await supabaseAdmin
      .from("orcamento_produto")
      .insert(itens.produtos.map((item) => ({ ...item, orcamentoid: orcamentoId })));
    if (error) throw error;
  }

  if (itens.servicos.length) {
    const { error } = await supabaseAdmin
      .from("orcamento_servico")
      .insert(itens.servicos.map((item) => ({ ...item, orcamentoid: orcamentoId })));
    if (error) throw error;
  }

  if (itens.produtosAvulsos.length) {
    const { error } = await supabaseAdmin
      .from("orcamento_produto_avulso")
      .insert(itens.produtosAvulsos.map((item) => ({ ...item, orcamentoid: orcamentoId })));
    if (error) throw error;
  }
}

/** Itens de um orcamento no formato que a tela do carrinho consome. */
export async function carregarItensDoOrcamento(orcamentoId: number) {
  const [produtosRes, servicosRes, avulsosRes] = await Promise.all([
    supabaseAdmin
      .from("orcamento_produto")
      .select(
        "produtoid, quantidade, precounitario, subtotal, desconto_tipo, desconto, produto:produtoid (id, titulo, descricao, referencia, etiqueta)",
      )
      .eq("orcamentoid", orcamentoId),
    supabaseAdmin
      .from("orcamento_servico")
      .select(
        "servicoid, descricao, quantidade, precounitario, subtotal, desconto_tipo, desconto, servico:servicoid (id, codigo, descricao)",
      )
      .eq("orcamentoid", orcamentoId),
    supabaseAdmin
      .from("orcamento_produto_avulso")
      .select("id, titulo, quantidade, precounitario, subtotal, desconto_tipo, desconto, desconto_informativo_tipo, desconto_informativo")
      .eq("orcamentoid", orcamentoId)
      .order("id", { ascending: true }),
  ]);

  if (produtosRes.error) throw produtosRes.error;
  if (servicosRes.error) throw servicosRes.error;
  if (avulsosRes.error) throw avulsosRes.error;

  const num = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  return {
    produtos: (produtosRes.data ?? []).map((row: any) => ({
      produtoid: num(row.produtoid),
      descricao: String(row.produto?.titulo || row.produto?.descricao || ""),
      referencia: String(row.produto?.referencia ?? "").trim() || null,
      etiqueta: String(row.produto?.etiqueta ?? "").trim() || null,
      quantidade: num(row.quantidade),
      precounitario: num(row.precounitario),
      subtotal: num(row.subtotal),
      descontoTipo: row.desconto_tipo ?? null,
      desconto: num(row.desconto),
    })),
    servicos: (servicosRes.data ?? []).map((row: any) => ({
      servicoid: num(row.servicoid),
      descricao: String(row.servico?.descricao ?? ""),
      referencia: String(row.servico?.codigo ?? "").trim() || null,
      descricaoServico: row.descricao ? String(row.descricao) : null,
      quantidade: num(row.quantidade),
      precounitario: num(row.precounitario),
      subtotal: num(row.subtotal),
      descontoTipo: row.desconto_tipo ?? null,
      desconto: num(row.desconto),
    })),
    produtosAvulsos: (avulsosRes.data ?? []).map((row: any) => ({
      descontoInformativoTipo: row.desconto_informativo_tipo ?? null,
      descontoInformativo: num(row.desconto_informativo),
      id: num(row.id),
      titulo: String(row.titulo ?? ""),
      quantidade: num(row.quantidade),
      precounitario: num(row.precounitario),
      subtotal: num(row.subtotal),
      descontoTipo: row.desconto_tipo ?? null,
      desconto: num(row.desconto),
    })),
  };
}
