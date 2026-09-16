// src/app/api/venda/export/produto/route.ts
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
 * Seleção: venda + cliente + itens (vendaproduto) + produto
 * (mesmo padrão que você já usa)
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
/**
 * Query params:
 * - produtoId (obrigatório)
 * - q (opcional) -> busca simples no cliente (nome/cpf) e no id da venda
 * - status (opcional)
 * - clienteId (opcional)
 * - dateFrom (opcional) YYYY-MM-DD (filtra datavenda >=)
 * - dateTo (opcional) YYYY-MM-DD (filtra datavenda < próximo dia)
 * - chunk (opcional) 200..5000
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const produtoId = toIntFilter(searchParams.get("produtoId"));
    if (produtoId == null) {
      return NextResponse.json(
        { error: "produtoId é obrigatório" },
        { status: 400 }
      );
    }

    // filtros
    const q = normalizeQ(searchParams.get("search") ?? searchParams.get("q") ?? "");
    const status = (searchParams.get("status") ?? "").trim();
    const clienteId = toIntFilter(searchParams.get("clienteId"));
    const dateFrom = searchParams.get("dateFrom"); // YYYY-MM-DD
    const dateTo = searchParams.get("dateTo"); // YYYY-MM-DD

    // paginação
    const CHUNK = Math.min(
      Math.max(Number(searchParams.get("chunk") ?? 1000), 200),
      5000
    );

    /** ====== Workbook e abas ====== */

    const wb = XLSX.utils.book_new();

    // Aba 1: Vendas (1 linha por venda que contenha o produto)
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
      "Produto ID (filtro)",
      "Qtd total do produto na venda",
      "Total do produto na venda (R$)",
    ] as const;

    const wsVendas = XLSX.utils.aoa_to_sheet([headersVendas as unknown as string[]]);
    XLSX.utils.book_append_sheet(wb, wsVendas, "Vendas");

    wsVendas["!cols"] = [
      { wch: 10 },
      { wch: 22 },
      { wch: 16 },
      { wch: 10 },
      { wch: 34 },
      { wch: 18 },
      { wch: 18 },
      { wch: 28 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 20 },
      { wch: 20 },
      { wch: 14 },
      { wch: 22 },
      { wch: 24 },
    ];

    // Aba 2: Itens (somente itens do produto filtrado)
    const headersItens = [
      "Item ID",
      "Venda ID",
      "Data Venda (Fortaleza)",
      "Status Venda",
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
      { wch: 10 },
      { wch: 10 },
      { wch: 22 },
      { wch: 16 },
      { wch: 10 },
      { wch: 34 },
      { wch: 10 },
      { wch: 34 },
      { wch: 18 },
      { wch: 10 },
      { wch: 12 },
      { wch: 14 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 18 },
      { wch: 22 },
      { wch: 22 },
    ];

    /** ====== Query base ====== */

    const buildQuery = () => {
      let query = supabaseAdmin
        .from("venda")
        .select(VENDA_SELECT, { count: "exact" })
        .order("datavenda", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true });

      // filtros venda
      if (status) query = query.eq("status", status);
      if (clienteId != null) query = query.eq("clienteid", clienteId);

      if (dateFrom) query = query.gte("datavenda", localDayStartToUtcIso(dateFrom));
      if (dateTo) query = query.lt("datavenda", localNextDayStartToUtcIso(dateTo));

      // filtra por produto (relacionamento vendaproduto)
      // OBS: isso depende do nome da relação no PostgREST.
      // Como você já seleciona "itens:vendaproduto(...)", normalmente dá pra filtrar com:
      query = query.eq("vendaproduto.produtoid", produtoId);

      // busca simples
      if (q) {
        const maybeId = idDeBusca(q);

        const ors: string[] = [
          `cliente.nomerazaosocial.ilike.%${q}%`,
          `cliente.cpfcnpj.ilike.%${q}%`,
        ];

        if (maybeId !== null) ors.push(`id.eq.${maybeId}`);
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

        // pega somente itens do produto filtrado (porque no select vem todos itens da venda)
        const itens = (v.itens ?? []) as any[];
        const itensProduto = itens.filter((it) => Number(it?.produtoid) === produtoId);

        if (!itensProduto.length) continue; // segurança

        const qtdTotal = itensProduto.reduce((acc, it) => acc + (toNum(it.quantidade) ?? 0), 0);
        const totalProduto = itensProduto.reduce((acc, it) => acc + (toNum(it.valor_total) ?? 0), 0);

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
          produtoId,
          qtdTotal || null,
          totalProduto || null,
        ]);

        // --- Aba Itens (apenas itens do produto) ---
        for (const it of itensProduto) {
          const qtd = toNum(it.quantidade);
          const totalItem = toNum(it.valor_total);
          const unit = qtd && totalItem != null && qtd !== 0 ? totalItem / qtd : null;

          rowsItens.push([
            it.id ?? "",
            v.id ?? "",
            formatFortaleza(v.datavenda ?? null),
            v.status ?? "",
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

    const filename = `vendas_produto_${produtoId}_${new Date()
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
      { error: e?.message || "Erro ao exportar vendas do produto" },
      { status: 500 }
    );
  }
}
