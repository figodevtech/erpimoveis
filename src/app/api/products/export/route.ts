// src/app/api/products/export/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import * as XLSX from "xlsx";

/** Status de estoque (para filtros) */
type Status = "OK" | "CRITICO" | "BAIXO" | "SEM_ESTOQUE";
const STATUS_SET = new Set<Status>(["OK", "CRITICO", "BAIXO", "SEM_ESTOQUE"]);

/** Campos a exportar (somente os que existem em public.produto) */
const EXPORT_FIELDS = `
  id, titulo, descricao, referencia,
  precovenda, precocompra, unidade,
  estoque, estoqueminimo, status_estoque,
  fabricante, grupo,
  ncm, cfop, csosn, cst, cst_pis, aliquota_pis, cst_cofins, aliquota_cofins, cest, aliquotaicms, codigobarras,
  createdat, updatedat
`;

function normalizeQ(input: string) {
  // evita bagunçar o ilike com % e _
  return input.trim().slice(0, 200).replace(/[%_]/g, "");
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const qRaw = searchParams.get("search") ?? searchParams.get("q") ?? "";
    const q = normalizeQ(qRaw);

    const statusParam = (searchParams.get("status") ?? "TODOS").toUpperCase();
    const statusFilter = STATUS_SET.has(statusParam as Status)
      ? (statusParam as Status)
      : null;

    // tamanho do bloco para varrer tudo
    const CHUNK = Math.min(
      Math.max(Number(searchParams.get("chunk") ?? 1000), 200),
      5000
    );

    // Cabeçalhos do Excel
    const headers = [
      "ID",
      "Título",
      "Descrição",
      "Referência",
      "Preço Venda",
      "Preço Médio de Compra",
      "Unidade",
      "Estoque",
      "Estoque Mín.",
      "Status Estoque",
      "Fabricante",
      "Grupo",
      "NCM",
      "CFOP",
      "CSOSN",
      "CST",
      "CST PIS",
      "Alíquota PIS",
      "CST COFINS",
      "Alíquota COFINS",
      "CEST",
      "Alíquota ICMS",
      "Código Barras",
      "Criado em",
      "Atualizado em",
    ] as const;

    // Cria workbook e planilha
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers as unknown as string[]]);
    XLSX.utils.book_append_sheet(wb, ws, "Produtos");

    // Larguras (opcional)
    ws["!cols"] = [
      { wch: 8 },  // ID
      { wch: 32 }, // Título
      { wch: 50 }, // Descrição
      { wch: 18 }, // Referência
      { wch: 14 }, // Preço Venda
      { wch: 14 }, // Preço Compra
      { wch: 10 }, // Unidade
      { wch: 10 }, // Estoque
      { wch: 12 }, // Estoque Mín.
      { wch: 14 }, // Status
      { wch: 24 }, // Fabricante
      { wch: 16 }, // Grupo
      { wch: 12 }, // NCM
      { wch: 10 }, // CFOP
      { wch: 10 }, // CSOSN
      { wch: 10 }, // CST
      { wch: 10 }, // CST PIS
      { wch: 14 }, // Alíquota PIS
      { wch: 12 }, // CST COFINS
      { wch: 16 }, // Alíquota COFINS
      { wch: 10 }, // CEST
      { wch: 14 }, // Alíquota ICMS
      { wch: 18 }, // Código Barras
      { wch: 20 }, // Criado em
      { wch: 20 }, // Atualizado em
    ];

    // Monta query base com filtros
    const buildQuery = () => {
      let query = supabaseAdmin
        .from("produto")
        .select(EXPORT_FIELDS, { count: "exact" })
        .eq("is_deleted", false)
        .order("id", { ascending: true });

      if (q) {
        // Somente colunas que existem em produto
        query = query.or(
          [
            `referencia.ilike.%${q}%`,
            `titulo.ilike.%${q}%`,
            `descricao.ilike.%${q}%`,
            `fabricante.ilike.%${q}%`,
            `codigobarras.ilike.%${q}%`,
            `ncm.ilike.%${q}%`,
          ].join(",")
        );
      }

      if (statusFilter) {
        query = query.eq("status_estoque", statusFilter);
      }

      return query;
    };

    // 1ª chamada só pra validar e evitar surpresa
    const first = await buildQuery().range(0, 0);
    if (first.error) throw first.error;

    // Varre tudo em blocos
    for (let from = 0; ; from += CHUNK) {
      const to = from + CHUNK - 1;
      const { data, error } = await buildQuery().range(from, to);
      if (error) throw error;

      const rows = (data ?? []).map((p: any) => [
        p.id ?? "",
        p.titulo ?? "",
        p.descricao ?? "",
        p.referencia ?? "",
        p.precovenda ?? null,
        p.precocompra ?? null,
        p.unidade ?? "",
        p.estoque ?? null,
        p.estoqueminimo ?? null,
        p.status_estoque ?? "",
        p.fabricante ?? "",
        p.grupo ?? "",
        p.ncm ?? "",
        p.cfop ?? "",
        p.csosn ?? "",
        p.cst ?? "",
        p.cst_pis ?? "",
        p.aliquota_pis ?? "",
        p.cst_cofins ?? "",
        p.aliquota_cofins ?? "",
        p.cest ?? "",
        p.aliquotaicms ?? null,
        p.codigobarras ?? "",
        p.createdat ? new Date(p.createdat) : "",
        p.updatedat ? new Date(p.updatedat) : "",
      ]);

      if (rows.length) {
        XLSX.utils.sheet_add_aoa(ws, rows as unknown as any[][], { origin: -1 });
      }

      if (!data?.length || data.length < CHUNK) break;
    }

    const buffer = XLSX.write(wb, {
      type: "buffer",
      bookType: "xlsx",
      cellDates: true,
    });

    const filename = `produtos_${(statusFilter ?? "TODOS")}_${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.xlsx`;

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
      { error: e?.message || "Erro ao exportar produtos" },
      { status: 500 }
    );
  }
}
