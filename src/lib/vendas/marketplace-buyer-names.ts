import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Nome do comprador nas vendas de marketplace.
 *
 * A venda do Mercado Livre nasce sem cliente próprio: o comprador é uma conta da
 * plataforma, não alguém cadastrado aqui. O nome fica em `mercadolivre_order.raw_order`,
 * e sem esta passada toda venda de ML sai com o cliente genérico — na listagem e
 * em qualquer relatório.
 *
 * Vivia dentro de `api/venda/route.ts`. Saiu de lá quando o relatório de vendas
 * passou a precisar do mesmo nome: duas cópias divergiriam, e a folha impressa
 * mostraria um comprador diferente do da tela.
 */
export function formatMercadoLivreBuyerName(rawOrder: any, buyerId?: number | null) {
  const buyer = rawOrder?.buyer ?? {};
  const fullName = [buyer.first_name, buyer.last_name].map((value) => String(value ?? "").trim()).filter(Boolean).join(" ");
  if (fullName) return fullName;
  if (buyer.nickname) return String(buyer.nickname).trim();
  const id = buyer.id ?? buyerId;
  return id ? `Comprador Mercado Livre #${id}` : "";
}

/**
 * Reescreve `venda.cliente.nomerazaosocial` das vendas de Mercado Livre do lote.
 *
 * Sai cedo quando não há nenhuma no recorte, então o caso comum não paga consulta
 * nenhuma. Muta as vendas recebidas e as devolve, como sempre fez.
 */
export async function applyMarketplaceBuyerNames(vendas: any[]) {
  const vendaIds = vendas
    .filter((venda) => String(venda?.canal ?? "").toUpperCase() === "MERCADO_LIVRE")
    .map((venda) => Number(venda.id))
    .filter(Number.isFinite);

  if (vendaIds.length === 0) return vendas;

  const { data, error } = await supabaseAdmin
    .from("mercadolivre_order")
    .select("venda_id, buyer_id, raw_order")
    .in("venda_id", vendaIds);

  if (error) throw error;

  const buyerNameByVenda = new Map<number, string>();
  for (const order of data ?? []) {
    const vendaId = Number((order as any).venda_id);
    const buyerName = formatMercadoLivreBuyerName((order as any).raw_order, (order as any).buyer_id);
    if (Number.isFinite(vendaId) && buyerName) buyerNameByVenda.set(vendaId, buyerName);
  }

  for (const venda of vendas) {
    const buyerName = buyerNameByVenda.get(Number(venda.id));
    if (!buyerName) continue;
    venda.cliente = {
      ...(venda.cliente ?? {}),
      nomerazaosocial: buyerName,
    };
  }

  return vendas;
}
