export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import * as XLSX from "xlsx";

const FORTALEZA_TZ = "America/Fortaleza";
const FORTALEZA_OFFSET = "-03:00";

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
  if (Number.isNaN(d.getTime())) return "";
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

const VENDA_SELECT = `
  id,
  status,
  valortotal,
  sub_total,
  desconto_tipo,
  desconto_valor,
  datavenda,
  cliente:clienteid ( nomerazaosocial, cpfcnpj ),
  vendedor:created_by ( nome )
`;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = (searchParams.get("userId") ?? "").trim();
    const dateFrom = (searchParams.get("dateFrom") ?? "").trim();
    const dateTo = (searchParams.get("dateTo") ?? "").trim();

    if (!userId) {
      return NextResponse.json({ error: "Selecione um usuário." }, { status: 400 });
    }

    let query = supabaseAdmin
      .from("venda")
      .select(VENDA_SELECT)
      .eq("created_by", userId)
      .order("datavenda", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true });

    if (dateFrom) query = query.gte("datavenda", localDayStartToUtcIso(dateFrom));
    if (dateTo) query = query.lt("datavenda", localNextDayStartToUtcIso(dateTo));

    const { data, error } = await query;
    if (error) throw error;

    const headers = [
      "Venda ID",
      "Data Venda",
      "Status",
      "Vendedor Nome",
      "Cliente Nome/Razão",
      "Cliente CPF/CNPJ",
      "Subtotal (R$)",
      "Desconto Tipo",
      "Desconto Valor (R$)",
      "Total (R$)",
    ] as const;

    const rows = (data ?? []).map((v: any) => {
      const cliente = firstOrSelf<any>(v.cliente);
      const vendedor = firstOrSelf<any>(v.vendedor);

      return [
        v.id ?? "",
        formatFortaleza(v.datavenda ?? null),
        v.status ?? "",
        vendedor?.nome ?? "",
        cliente?.nomerazaosocial ?? "",
        cliente?.cpfcnpj ?? "",
        toNum(v.sub_total) ?? null,
        v.desconto_tipo ?? "",
        toNum(v.desconto_valor) ?? null,
        toNum(v.valortotal) ?? null,
      ];
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers as unknown as string[], ...rows]);
    ws["!cols"] = [
      { wch: 10 }, // Venda ID
      { wch: 22 }, // Data Venda
      { wch: 16 }, // Status
      { wch: 28 }, // Vendedor Nome
      { wch: 34 }, // Cliente Nome/Razão
      { wch: 18 }, // Cliente CPF/CNPJ
      { wch: 16 }, // Subtotal (R$)
      { wch: 16 }, // Desconto Tipo
      { wch: 16 }, // Desconto Valor (R$)
      { wch: 16 }, // Total (R$)
    ];
    XLSX.utils.book_append_sheet(wb, ws, "Vendas por usuário");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const filename = `vendas_usuario_${new Date().toISOString().replace(/[:.]/g, "-")}.xlsx`;

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
      { error: e?.message || "Erro ao exportar vendas por usuário" },
      { status: 500 }
    );
  }
}
