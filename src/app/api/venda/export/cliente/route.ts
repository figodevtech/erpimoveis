// src/app/api/venda/export/cliente/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { idDeBusca } from "@/lib/busca-numerica";
import * as XLSX from "xlsx";

/** ====== Constantes e helpers ====== */

const FORTALEZA_TZ = "America/Fortaleza";
const FORTALEZA_OFFSET = "-03:00";

function normalizeQ(input: string) {
  return input.trim().slice(0, 200).replace(/[%_]/g, "");
}

function toIntFilter(v: string | null) {
  if (!v) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function localDayStartToUtcIso(dateStr: string) {
  return new Date(`${dateStr}T00:00:00${FORTALEZA_OFFSET}`).toISOString();
}
function localNextDayStartToUtcIso(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00${FORTALEZA_OFFSET}`);
  return new Date(d.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function formatFortaleza(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: FORTALEZA_TZ,
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

function toNum(v: any): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function firstOrSelf<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/**
 * venda + cliente + itens (vendaproduto) + produto
 * Obs: datavenda pode ser null no schema.
 */
const VENDA_SELECT = `
  id, status, valortotal, sub_total, desconto_tipo, desconto_valor, datavenda, createdat, updatedat, clienteid,
  cliente:clienteid ( id, nomerazaosocial, cpfcnpj, telefone, email ),
  itens:vendaproduto (
    id,
    venda_id,
    produtoid,
    quantidade,
    sub_total,
    valor_total,
    valor_desconto,
    tipo_desconto,
    created_at,
    updated_at,
    produto:produtoid ( id, titulo, referencia, unidade, precovenda )
  )
`;

/** ====== GET: export Excel (2 abas) ====== */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    // filtros
    const q = normalizeQ(searchParams.get("search") ?? searchParams.get("q") ?? "");
    const status = (searchParams.get("status") ?? "").trim().toUpperCase(); // enum_status_venda
    const clienteId = toIntFilter(searchParams.get("clienteId"));
    const dateFrom = searchParams.get("dateFrom"); // YYYY-MM-DD
    const dateTo = searchParams.get("dateTo");     // YYYY-MM-DD

    // paginação
    const CHUNK = Math.min(
      Math.max(Number(searchParams.get("chunk") ?? 1000), 200),
      5000
    );

    /** ====== Workbook e abas ====== */

    const wb = XLSX.utils.book_new();

    // Aba 1: Vendas (1 linha por venda)
    const headersVendas = [
      "Venda ID",
      "Data Venda (Fortaleza)",
      "Status",
      "Cliente ID",
      "Cliente Nome/Razão",
      "Cliente CPF/CNPJ",
      "Cliente Telefone",
      "Cliente Email",
      "Subtotal (R$)",
      "Desconto Tipo",
      "Desconto Valor (R$)",
      "Total (R$)",
      "Criado em (Fortaleza)",
      "Atualizado em (Fortaleza)",
    ] as const;

    const wsVendas = XLSX.utils.aoa_to_sheet([headersVendas as unknown as string[]]);
    XLSX.utils.book_append_sheet(wb, wsVendas, "Vendas");

    wsVendas["!cols"] = [
      { wch: 10 }, // Venda ID
      { wch: 22 }, // Data venda
      { wch: 16 }, // Status
      { wch: 10 }, // Cliente ID
      { wch: 34 }, // Cliente nome
      { wch: 18 }, // CPF/CNPJ
      { wch: 18 }, // Telefone
      { wch: 28 }, // Email
      { wch: 16 }, // Subtotal
      { wch: 16 }, // Desconto tipo
      { wch: 16 }, // Desconto valor
      { wch: 16 }, // Total
      { wch: 20 }, // Criado em
      { wch: 20 }, // Atualizado em
    ];

    // Aba 2: Itens (1 linha por item comprado)
    const headersItens = [
      "Item ID",
      "Venda ID",
      "Data Venda (Fortaleza)",
      "Cliente ID",
      "Cliente Nome/Razão",
      "Produto ID",
      "Produto Título",
      "Produto Referência",
      "Unidade",
      "Quantidade",
      "Preço Unit. (R$)",
      "Subtotal Item (R$)",
      "Desconto Item (R$)",
      "Total Item (R$)",
      "Desconto Tipo (Item)",
      "Criado em Item (Fortaleza)",
      "Atualizado em Item (Fortaleza)",
    ] as const;

    const wsItens = XLSX.utils.aoa_to_sheet([headersItens as unknown as string[]]);
    XLSX.utils.book_append_sheet(wb, wsItens, "Itens");

    wsItens["!cols"] = [
      { wch: 10 }, // Item ID
      { wch: 10 }, // Venda ID
      { wch: 22 }, // Data venda
      { wch: 10 }, // Cliente ID
      { wch: 34 }, // Cliente nome
      { wch: 10 }, // Produto ID
      { wch: 34 }, // Produto título
      { wch: 18 }, // Referência
      { wch: 10 }, // Unidade
      { wch: 12 }, // Quantidade
      { wch: 14 }, // Preço unit
      { wch: 16 }, // Subtotal item
      { wch: 16 }, // Desconto item
      { wch: 16 }, // Total item
      { wch: 18 }, // Desconto tipo
      { wch: 22 }, // Criado em item
      { wch: 22 }, // Atualizado em item
    ];

    /** ====== Query base ====== */

    const buildQuery = () => {
      let query = supabaseAdmin
        .from("venda")
        .select(VENDA_SELECT, { count: "exact" })
        .order("datavenda", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true });

      if (status) query = query.eq("status", status);
      if (clienteId != null) query = query.eq("clienteid", clienteId);

      if (dateFrom) query = query.gte("datavenda", localDayStartToUtcIso(dateFrom));
      if (dateTo) query = query.lt("datavenda", localNextDayStartToUtcIso(dateTo));

      // Busca simples: cliente (nome/cpf) e ID da venda quando q é número
      if (q) {
        const maybeId = idDeBusca(q);

        const ors: string[] = [
          `cliente.nomerazaosocial.ilike.%${q}%`,
          `cliente.cpfcnpj.ilike.%${q}%`,
        ];

        if (maybeId !== null) {
          ors.push(`id.eq.${maybeId}`);
        }

        query = query.or(ors.join(","));
      }

      return query;
    };

    // valida
    const first = await buildQuery().range(0, 0);
    if (first.error) throw first.error;

    /** ====== Varrendo e preenchendo as duas abas ====== */

    for (let from = 0; ; from += CHUNK) {
      const to = from + CHUNK - 1;
      const { data, error } = await buildQuery().range(from, to);
      if (error) throw error;

      const rowsVendas: any[][] = [];
      const rowsItens: any[][] = [];

      for (const v of data ?? []) {
        const cli = firstOrSelf<any>(v.cliente);

        // --- Aba Vendas ---
        rowsVendas.push([
          v.id ?? "",
          formatFortaleza(v.datavenda ?? null),
          v.status ?? "",
          v.clienteid ?? "",
          cli?.nomerazaosocial ?? "",
          cli?.cpfcnpj ?? "",
          cli?.telefone ?? "",
          cli?.email ?? "",
          toNum(v.sub_total) ?? null,
          v.desconto_tipo ?? "",
          toNum(v.desconto_valor) ?? null,
          toNum(v.valortotal) ?? null,
          formatFortaleza(v.createdat ?? null),
          formatFortaleza(v.updatedat ?? null),
        ]);

        // --- Aba Itens ---
        const itens = (v.itens ?? []) as any[];
        for (const it of itens) {
          const qtd = toNum(it.quantidade);
          const totalItem = toNum(it.valor_total);
          const unit =
            qtd && totalItem != null && qtd !== 0 ? totalItem / qtd : null;

          rowsItens.push([
            it.id ?? "",
            v.id ?? "",
            formatFortaleza(v.datavenda ?? null),
            v.clienteid ?? "",
            cli?.nomerazaosocial ?? "",
            it?.produto?.id ?? it?.produtoid ?? "",
            it?.produto?.titulo ?? "",
            it?.produto?.referencia ?? "",
            it?.produto?.unidade ?? "",
            qtd ?? null,
            unit ?? null,
            toNum(it.sub_total) ?? null,
            toNum(it.valor_desconto) ?? null,
            totalItem ?? null,
            it.tipo_desconto ?? "",
            formatFortaleza(it.created_at ?? null),
            formatFortaleza(it.updated_at ?? null),
          ]);
        }
      }

      if (rowsVendas.length) XLSX.utils.sheet_add_aoa(wsVendas, rowsVendas, { origin: -1 });
      if (rowsItens.length) XLSX.utils.sheet_add_aoa(wsItens, rowsItens, { origin: -1 });

      if (!data?.length || data.length < CHUNK) break;
    }

    /** ====== Export ====== */

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const filename = `historico_compras_vendas_${new Date()
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
      { error: e?.message || "Erro ao exportar histórico de compras" },
      { status: 500 }
    );
  }
}
