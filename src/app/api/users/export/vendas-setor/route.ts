export const runtime = "nodejs";

import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { requireRelatoriosAccess } from "@/app/api/_authz/perms";
import { carregarVendasPorSetor } from "@/lib/vendas/vendas-por-setor";

/**
 * Vendas por setor, em xlsx.
 *
 * A consulta e o agrupamento vivem em `@/lib/vendas/vendas-por-setor`, e são os
 * mesmos que a folha de impressão usa — antes cada lado tinha a sua cópia, e as
 * duas podiam responder coisas diferentes para o mesmo período.
 */
export async function GET(req: Request) {
  try {
    await requireRelatoriosAccess();
    const { searchParams } = new URL(req.url);

    const relatorio = await carregarVendasPorSetor({
      inicio: searchParams.get("inicio") ?? "",
      fim: searchParams.get("fim") ?? "",
      setor: searchParams.get("setor") ?? "",
    });

    if (relatorio.setores.length === 0) {
      return NextResponse.json(
        { error: "Nenhuma venda realizada encontrada neste período." },
        { status: 404 },
      );
    }

    // A planilha sai na ordem já resolvida pelo agrupamento — setor, vendedor e
    // data —, para bater linha a linha com o que o papel mostra.
    const linhas = relatorio.setores.flatMap((setor) =>
      setor.vendedores.flatMap((vendedor) =>
        vendedor.itens.map((item) => ({
          Setor: setor.nome,
          Vendedor: vendedor.nome,
          "Nº Venda": item.vendaId,
          Cliente: item.cliente,
          "Data Venda": item.dataVenda,
          Status: item.status,
          "Valor Total": item.valorTotal,
          Frete: item.valorFrete,
          // Sem esta coluna, Valor Total x Percentual nao bate com a comissao
          // e o leitor procura um erro que nao existe: o frete fica fora.
          "Base Comissão": item.baseComissao,
          "Comissão (%)": item.percentualComissao,
          "Comissão (R$)": item.valorComissao,
        })),
      ),
    );

    const worksheet = XLSX.utils.json_to_sheet(linhas);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Vendas por Setor");

    const buf = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Disposition": 'attachment; filename="vendas_por_setor.xlsx"',
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    console.error("Erro na exportação Excel (vendas-setor):", error);
    return NextResponse.json(
      { error: error?.message || "Erro interno ao gerar Excel" },
      { status: error?.statusCode || 500 },
    );
  }
}
