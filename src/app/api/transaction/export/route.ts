// src/app/api/transaction/export/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import * as XLSX from "xlsx";

import { filtroDeBusca } from "../_lib/busca";

/** ====== Constantes e helpers ====== */

const FORTALEZA_TZ = "America/Fortaleza";
const FORTALEZA_OFFSET = "-03:00";

/**
 * Campos do seu schema:
 * transacao: id, descricao, valor, "valorLiquido", data, ordemservicoid, metodopagamento, categoria, tipo,
 *           cliente_id, banco_id, created_at, updated_at
 */
const TRANSACAO_FIELDS =
  'id, descricao, descricao_pagamento, valor, "valorLiquido", nomepagador, cpfcnpjpagador, pendente, data, ordemservicoid, vendaid, evento_financeiro_id, metodopagamento, categoria, categoria_id, plano_de_conta, plano_de_conta_id, centro_custo, centro_custo_id, tipo, cliente_id, banco_id, created_at, updated_at';

/** bancoconta: id, titulo, ... , created_at, updated_at */
const BANCO_FIELDS = "id, titulo, created_at, updated_at";

// Date helpers
function localDayStartToUtcIso(dateStr: string) {
  return new Date(`${dateStr}T00:00:00${FORTALEZA_OFFSET}`).toISOString();
}
function localNextDayStartToUtcIso(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00${FORTALEZA_OFFSET}`);
  return new Date(d.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

// Conversão de timestamp -> string local Fortaleza
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

function normalizeQ(input: string) {
  return input.trim().slice(0, 200).replace(/[%_]/g, "");
}

// banco_id é bigint: pode vir grande. Aqui aceito número ou string.
function toBigintFilter(v: string | null) {
  if (!v) return null;
  const s = v.trim();
  if (!s) return null;
  // só dígitos
  if (!/^\d+$/.test(s)) return null;
  // se for seguro como number, ok; senão mantém string (PostgREST aceita string p/ bigint)
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : s;
}

function toIntFilter(v: string | null) {
  if (!v) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/** ====== GET: export Excel ====== */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const q = normalizeQ(searchParams.get("search") ?? searchParams.get("q") ?? "");

    const tipo = (searchParams.get("tipo") ?? "").trim();
    // Lista, para as abas que agrupam dois tipos (a receber = RECEITA+DEPOSITO,
    // a pagar = DESPESA+SAQUE). Sem ela a exportacao dessas abas sairia sem
    // filtro de tipo nenhum, trazendo mais linhas do que a tela mostra.
    const tipos = String(searchParams.get("tipos") ?? "")
      .split(",")
      .map((item) => item.trim().toUpperCase())
      .filter((item) => ["RECEITA", "DESPESA", "DEPOSITO", "SAQUE"].includes(item));
    const categoria = (searchParams.get("categoria") ?? "").trim();
    const categoriaId = toIntFilter(searchParams.get("categoriaId"));

    const ordemservicoid = toIntFilter(searchParams.get("ordemservicoid"));
    const vendaid = toIntFilter(searchParams.get("vendaid"));
    const metodo = (searchParams.get("metodo") ?? searchParams.get("metodopagamento") ?? "")
      .trim()
      .slice(0, 100);

    const bancoId = toBigintFilter(searchParams.get("bancoId"));
    const planoContaId = toIntFilter(searchParams.get("planoContaId"));
    const centroCustoId = toIntFilter(searchParams.get("centroCustoId"));
    const clienteId = toIntFilter(searchParams.get("clienteId"));
    const pendenteParam = searchParams.get("pendente");
    const pendente = pendenteParam === "true" ? true : pendenteParam === "false" ? false : null;
    const nomePagador = normalizeQ(searchParams.get("nomePagador") ?? "");
    const documentoPagador = String(searchParams.get("documentoPagador") ?? "").replace(/\D/g, "").slice(0, 20);
    const valorMinRaw = searchParams.get("valorMin");
    const valorMaxRaw = searchParams.get("valorMax");
    const valorMin = valorMinRaw ? Number(valorMinRaw) : null;
    const valorMax = valorMaxRaw ? Number(valorMaxRaw) : null;
    const vinculo = String(searchParams.get("vinculo") ?? "").trim().toUpperCase();

    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    // Tamanho do bloco para varrer no Supabase
    const CHUNK = Math.min(
      Math.max(Number(searchParams.get("chunk") ?? 1000), 200),
      5000
    );

    // Cabeçalhos do Excel
    const headers = [
      "ID",
      "Descrição",
      "Descrição do pagamento",
      "Tipo",
      "Categoria",
      "Plano de conta",
      "Centro de custo",
      "Método Pagamento",
      "Valor (R$)",
      "Valor Líquido (R$)",
      "Data (Fortaleza)",
      "Situação",
      "Ordem Serviço",
      "Venda",
      "Evento financeiro",
      "Cliente ID",
      "Pagador",
      "Documento do pagador",
      "Banco ID",
      "Banco Título",
      "Criado em",
      "Atualizado em",
    ] as const;

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers as unknown as string[]]);
    XLSX.utils.book_append_sheet(wb, ws, "Transacoes");

    ws["!cols"] = [
      { wch: 8 },  // ID
      { wch: 40 }, // Descrição
      { wch: 34 }, // Descrição do pagamento
      { wch: 12 }, // Tipo
      { wch: 18 }, // Categoria
      { wch: 28 }, // Plano de conta
      { wch: 24 }, // Centro de custo
      { wch: 18 }, // Método
      { wch: 14 }, // Valor
      { wch: 16 }, // Valor Líquido
      { wch: 22 }, // Data (Fortaleza)
      { wch: 14 }, // Situação
      { wch: 14 }, // OS
      { wch: 12 }, // Venda
      { wch: 18 }, // Evento
      { wch: 12 }, // Cliente ID
      { wch: 28 }, // Pagador
      { wch: 22 }, // Documento
      { wch: 14 }, // Banco ID (bigint)
      { wch: 28 }, // Banco Título
      { wch: 20 }, // Criado em
      { wch: 20 }, // Atualizado em
    ];

    const buildQuery = () => {
      let query = supabaseAdmin
        .from("transacao")
        .select(
          `
            ${TRANSACAO_FIELDS},
            banco:bancoconta!transacao_banco_id_fkey ( ${BANCO_FIELDS} )
          `,
          { count: "exact" }
        )
        .eq("is_deleted", false)
        .order("data", { ascending: true })
        .order("id", { ascending: true });

      // Mesma varredura da lista: o arquivo exportado tem que ser o que o
      // usuário estava vendo, não um recorte mais estreito.
      const buscaEm = filtroDeBusca(q ?? "");
      if (buscaEm) query = query.or(buscaEm);
      if (ordemservicoid != null) query = query.eq("ordemservicoid", ordemservicoid);
      if (vendaid != null) query = query.eq("vendaid", vendaid);
      if (tipos.length > 0) query = query.in("tipo", tipos);
      else if (tipo) query = query.eq("tipo", tipo);
      if (categoria) query = query.eq("categoria", categoria);
      if (categoriaId != null) query = query.eq("categoria_id", categoriaId);
      if (metodo) query = query.eq("metodopagamento", metodo);
      if (bancoId != null) query = query.eq("banco_id", bancoId as any);
      if (planoContaId != null) query = query.eq("plano_de_conta_id", planoContaId);
      if (centroCustoId != null) query = query.eq("centro_custo_id", centroCustoId);
      if (clienteId != null) query = query.eq("cliente_id", clienteId);
      if (pendente !== null) query = query.eq("pendente", pendente);
      if (nomePagador) query = query.ilike("nomepagador", `%${nomePagador}%`);
      if (documentoPagador) query = query.ilike("cpfcnpjpagador", `%${documentoPagador}%`);
      if (valorMin != null && Number.isFinite(valorMin) && valorMin >= 0) query = query.gte("valor", valorMin);
      if (valorMax != null && Number.isFinite(valorMax) && valorMax >= 0) query = query.lte("valor", valorMax);
      if (vinculo === "OS") query = query.not("ordemservicoid", "is", null);
      if (vinculo === "VENDA") query = query.not("vendaid", "is", null);
      if (vinculo === "EVENTO") query = query.not("evento_financeiro_id", "is", null);
      if (vinculo === "AVULSO") {
        query = query.is("ordemservicoid", null).is("vendaid", null).is("evento_financeiro_id", null);
      }

      if (dateFrom) query = query.gte("data", localDayStartToUtcIso(dateFrom));
      if (dateTo) query = query.lt("data", localNextDayStartToUtcIso(dateTo));

      return query;
    };

    // valida
    const first = await buildQuery().range(0, 0);
    if (first.error) throw first.error;

    for (let from = 0; ; from += CHUNK) {
      const to = from + CHUNK - 1;
      const { data, error } = await buildQuery().range(from, to);
      if (error) throw error;

      const rows = (data ?? []).map((t: any) => [
        t.id ?? "",
        t.descricao ?? "",
        t.descricao_pagamento ?? "",
        t.tipo ?? "",
        t.categoria ?? "",
        t.plano_de_conta ?? "",
        t.centro_custo ?? "",
        t.metodopagamento ?? "",
        t.valor ?? null,
        t["valorLiquido"] ?? null, // <-- no schema é "valorLiquido"
        formatFortaleza(t.data ?? null),
        t.pendente ? "Pendente" : "Realizada",
        t.ordemservicoid ?? "",
        t.vendaid ?? "",
        t.evento_financeiro_id ?? "",
        t.cliente_id ?? "",
        t.nomepagador ?? "",
        t.cpfcnpjpagador ?? "",
        t.banco_id ?? "",
        t?.banco?.titulo ?? "",
        formatFortaleza(t.created_at ?? null),
        formatFortaleza(t.updated_at ?? null),
      ]);

      if (rows.length) {
        XLSX.utils.sheet_add_aoa(ws, rows as unknown as any[][], { origin: -1 });
      }

      if (!data?.length || data.length < CHUNK) break;
    }

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const filename = `transacoes_${new Date()
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
      { error: e?.message || "Erro ao exportar transações" },
      { status: 500 }
    );
  }
}
