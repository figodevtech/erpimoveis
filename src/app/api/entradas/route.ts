export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireEstoqueAccess, requireEstoqueCreate } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { entradaErrorResponse, registrarEntradaConfirmada } from "@/services/estoque/entradaService";

export async function GET(req: NextRequest) {
  try {
    await requireEstoqueAccess();
    const produtoId = new URL(req.url).searchParams.get("produtoid");
    if (produtoId && (!/^\d+$/.test(produtoId) || Number(produtoId) <= 0)) {
      return NextResponse.json({ error: "Produto inválido." }, { status: 400 });
    }

    const select = `
      id, created_at, fornecedorid, fiscal, notachave, tipo, status, origem,
      numero_nota, serie_nota, data_emissao, valor_total, cancelada_at,
      entradaitens${produtoId ? "!inner" : ""}(
        id, produto_id, unidade, quantidade, precovenda, valor_unitario_compra,
        valor_desconto, valor_frete, outras_despesas, valor_total,
        ncm, cest, csosn, referencia, titulo, "cClassTrib", "cstIbs", "cstCbs",
        cst, aliquotaicms, cfop, cst_pis, aliquota_pis, cst_cofins, aliquota_cofins
      )
    `;
    let query = supabaseAdmin.from("entrada").select(select).order("created_at", { ascending: false });
    if (produtoId) query = query.eq("entradaitens.produto_id", Number(produtoId));
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error: any) {
    const parsed = entradaErrorResponse(error);
    return NextResponse.json({ error: parsed.message }, { status: parsed.status });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireEstoqueCreate();
    const result = await registrarEntradaConfirmada(await req.json(), "AJUSTE_RAPIDO");
    return NextResponse.json(
      { success: true, entradaId: result.entrada_id, valorTotal: result.valor_total },
      { status: 201 },
    );
  } catch (error: any) {
    const parsed = entradaErrorResponse(error);
    return NextResponse.json({ error: parsed.message }, { status: parsed.status });
  }
}
