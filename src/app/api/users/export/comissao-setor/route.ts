export const runtime = "nodejs";

import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { requireRelatoriosAccess } from "@/app/api/_authz/perms";
import { carregarComissoes } from "@/lib/ordens/comissoes-de-servico";

/**
 * Comissões por setor, em xlsx.
 *
 * A consulta e o agrupamento vivem em `@/lib/ordens/comissoes-de-servico`, os
 * mesmos que a folha de impressão usa e com o mesmo recorte da Central Pessoal.
 * Antes cada lado tinha a sua cópia, e nenhuma batia com a outra.
 */
export async function GET(req: Request) {
  try {
    await requireRelatoriosAccess();
    const { searchParams } = new URL(req.url);

    const relatorio = await carregarComissoes({
      inicio: searchParams.get("inicio") ?? "",
      fim: searchParams.get("fim") ?? "",
      setor: searchParams.get("setor") ?? "",
    });

    if (relatorio.setores.length === 0) {
      return NextResponse.json(
        { error: "Nenhum serviço comissionável encontrado neste período." },
        { status: 404 },
      );
    }

    // Sai na ordem já resolvida pelo agrupamento — setor, realizador e OS —,
    // para bater linha a linha com o que o papel mostra.
    const flatRows = relatorio.setores.flatMap((setor) =>
      setor.realizadores.flatMap((realizador) =>
        realizador.itens.map((item) => ({
          OS: item.ordemId,
          "Status da OS": item.osStatus,
          "Início da Execução": item.execucaoInicio,
          "Fim da Execução": item.execucaoFim,
          Setor: setor.nome,
          Funcionário: realizador.nome,
          Cliente: item.clienteNome,
          Serviço: item.servicoDescricao,
          "Gera comissão": item.geraComissao ? "Sim" : "Não",
          "Valor Base": item.valorBase,
          "Percentual (%)": item.percentualAplicado,
          Comissão: item.valorComissao,
        })),
      ),
    );

    const ws = XLSX.utils.json_to_sheet(flatRows);
    ws["!cols"] = [
      { wch: 10 }, // OS
      { wch: 16 }, // Status da OS
      { wch: 18 }, // Início da Execução
      { wch: 18 }, // Fim da Execução
      { wch: 25 }, // Setor
      { wch: 30 }, // Funcionário
      { wch: 32 }, // Cliente
      { wch: 35 }, // Serviço
      { wch: 14 }, // Gera comissão
      { wch: 15 }, // Valor Base
      { wch: 15 }, // Percentual
      { wch: 15 }, // Comissão
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Comissões por Setor");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Disposition": 'attachment; filename="comissao_por_setor.xlsx"',
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("[export-comissao-setor] /api/users/export/comissao-setor:", err);
    return NextResponse.json(
      { error: err?.message || "Falha na exportação." },
      { status: err?.statusCode || 500 },
    );
  }
}
