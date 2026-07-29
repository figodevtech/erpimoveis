// app/api/veiculos/cliente/[clienteId]/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";

export const revalidate = 0;

function respostaJSON(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function normalizarPlaca(valor: string) {
  return valor.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function parseIntSeguro(valor: string | null) {
  if (!valor) return null;
  const n = Number(valor);
  return Number.isInteger(n) ? n : null;
}

function idValido(raw: string) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

// ROTA: /api/veiculos/cliente/[clienteId]
type Ctx = { params: Promise<{ clienteId: string }> };

export async function GET(request: Request, ctx: Ctx) {
  try {
    const { searchParams } = new URL(request.url);

    // ✅ Next 15: params pode vir como Promise nos tipos gerados
    const { clienteId: clienteIdRaw } = await ctx.params;

    const rawId = (clienteIdRaw || "").trim();
    const clienteId = idValido(rawId);
    if (!clienteId) {
      return respostaJSON({ error: "Parâmetro 'clienteId' inválido." }, 400);
    }

    const placa = (searchParams.get("placa") || "").trim();
    const q = (searchParams.get("q") || "").trim();
    const tipo = (searchParams.get("tipo") || "").trim();

    const limitRaw = parseIntSeguro(searchParams.get("limit"));
    const offsetRaw = parseIntSeguro(searchParams.get("offset"));
    const limit = Math.min(Math.max(limitRaw ?? 50, 1), 200);
    const offset = Math.max(offsetRaw ?? 0, 0);

    let query = supabase
      .from("veiculo")
      .select(
        "id, clienteid, placa, placa_formatada, modelo, marca, ano, cor, kmatual, tipo",
        { count: "exact" }
      )
      .eq("clienteid", clienteId)
      .order("modelo", { ascending: true })
      .range(offset, offset + limit - 1);

    if (placa) query = query.eq("placa", normalizarPlaca(placa));
    if (tipo) query = query.eq("tipo", tipo);

    if (q) {
      const termo = `%${q}%`;
      query = query.or(`modelo.ilike.${termo},marca.ilike.${termo}`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return respostaJSON({
      veiculos: data ?? [],
      total: count ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error("GET /api/veiculos/cliente/[clienteId]", err);
    return respostaJSON({ error: "Falha ao listar veículos" }, 500);
  }
}
