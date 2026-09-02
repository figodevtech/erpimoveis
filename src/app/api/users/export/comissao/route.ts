export const runtime = "nodejs";

import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { requireRelatoriosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { carregarComissoes } from "@/lib/ordens/comissoes-de-servico";

/**
 * Comissões de um realizador, em xlsx.
 *
 * Antes esta rota não filtrava nada: trazia todo vínculo do usuário em
 * `osservico_realizador`, sem status e sem `is_deleted`, e por isso somava
 * comissão de OS ainda `EM_ANDAMENTO` e de OS `CANCELADO`. O período, por cima,
 * saía de `ordemservico.createdat` — a data em que a linha foi inserida.
 *
 * O recorte agora vem de `@/lib/ordens/comissoes-de-servico`, que é o mesmo da
 * Central Pessoal e o mesmo do relatório por setor.
 */
export async function GET(req: Request) {
  try {
    await requireRelatoriosAccess();
    const { searchParams } = new URL(req.url);
    const userId = (searchParams.get("userId") ?? "").trim();
    const dateFrom = (searchParams.get("dateFrom") ?? "").trim();
    const dateTo = (searchParams.get("dateTo") ?? "").trim();

    if (!userId) {
      return NextResponse.json({ error: "Selecione um realizador." }, { status: 400 });
    }

    const [{ data: usuarioRow, error: usuarioErr }, relatorio] = await Promise.all([
      supabaseAdmin.from("usuario").select("id, nome, email").eq("id", userId).maybeSingle(),
      carregarComissoes({ inicio: dateFrom, fim: dateTo, usuarioId: userId }),
    ]);
    if (usuarioErr) throw usuarioErr;

    const headers = [
      "OS ID",
      "Status OS",
      "Fim da Execução",
      "Realizador ID",
      "Realizador Nome",
      "Realizador Email",
      "Cliente ID",
      "Cliente Nome/Razão",
      "Cliente CPF/CNPJ",
      "Serviço ID",
      "Serviço Código",
      "Serviço Descrição",
      "Gera comissão",
      "Quantidade",
      "Preço Unit. (R$)",
      "Subtotal Serviço (R$)",
      "Base Comissão (R$)",
      "Percentual Aplicado (%)",
      "Comissão (R$)",
    ] as const;

    const rows = relatorio.linhas.map((linha) => [
      linha.ordemId,
      linha.osStatus,
      linha.execucaoFim,
      usuarioRow?.id ?? linha.usuarioId,
      usuarioRow?.nome ?? "",
      usuarioRow?.email ?? "",
      linha.clienteId ?? "",
      linha.clienteNome,
      linha.clienteDocumento,
      linha.servicoId,
      linha.servicoCodigo,
      linha.servicoDescricao,
      linha.geraComissao ? "Sim" : "Não",
      linha.quantidade,
      linha.precoUnitario,
      linha.subtotalServico,
      linha.valorBase,
      linha.percentualAplicado,
      linha.valorComissao,
    ]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers as unknown as string[], ...rows]);
    ws["!cols"] = [
      { wch: 10 }, // OS ID
      { wch: 16 }, // Status OS
      { wch: 20 }, // Fim da Execução
      { wch: 38 }, // Realizador ID
      { wch: 28 }, // Realizador Nome
      { wch: 30 }, // Realizador Email
      { wch: 10 }, // Cliente ID
      { wch: 34 }, // Cliente Nome
      { wch: 18 }, // Cliente CPF/CNPJ
      { wch: 10 }, // Serviço ID
      { wch: 18 }, // Serviço Código
      { wch: 36 }, // Serviço Descrição
      { wch: 14 }, // Gera comissão
      { wch: 12 }, // Quantidade
      { wch: 16 }, // Preço Unit.
      { wch: 18 }, // Subtotal
      { wch: 18 }, // Base
      { wch: 18 }, // Percentual
      { wch: 16 }, // Comissão
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Comissão por serviço");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const filename = `comissao_servico_${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Erro ao exportar comissão por serviço" },
      { status: e?.statusCode || 500 },
    );
  }
}
