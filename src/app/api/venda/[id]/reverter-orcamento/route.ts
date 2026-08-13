export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireVendasEdit } from "@/app/api/_authz/perms";
import { syncPendingMercadoLivreStock } from "@/lib/integrations/mercadolivre-stock-sync";

type Context = { params: Promise<{ id: string }> };

function statusDoErro(error: any) {
  const code = String(error?.code ?? "");
  if (code === "P0002") return 404;
  if (["22023", "23514"].includes(code)) return 409;
  return Number(error?.statusCode) || 500;
}

/**
 * Devolve a venda de PAGAMENTO para ORCAMENTO: estoque volta e as transações
 * vinculadas são apagadas. Itens e valores permanecem, que é o motivo de existir
 * este caminho em vez de cancelar e refazer a venda.
 */
export async function POST(_req: Request, context: Context) {
  try {
    await requireVendasEdit();
    const vendaId = Number((await context.params).id);
    if (!Number.isInteger(vendaId) || vendaId <= 0) {
      return NextResponse.json({ error: "Venda inválida." }, { status: 400 });
    }

    const session = await auth();
    const usuarioId = String((session?.user as any)?.id ?? "") || null;

    // Lido antes da reversão: o estorno apaga as linhas de baixa da venda.
    const { data: baixas } = await supabaseAdmin
      .from("vendaproduto_baixa")
      .select("produtoid")
      .eq("venda_id", vendaId);
    const productIds = Array.from(
      new Set((baixas ?? []).map((item) => Number(item.produtoid)).filter(Number.isFinite)),
    );

    const { data, error } = await supabaseAdmin.rpc("reverter_venda_para_orcamento", {
      p_venda_id: vendaId,
      p_usuario_id: usuarioId,
    });
    if (error) throw error;

    const marketplaceStockSync = await syncPendingMercadoLivreStock({
      productIds,
      limit: productIds.length || 1,
    }).catch(() => []);

    return NextResponse.json({
      message: "Venda mantida como orçamento.",
      data,
      marketplaceStockSync,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Erro ao voltar a venda para orçamento." },
      { status: statusDoErro(error) },
    );
  }
}
