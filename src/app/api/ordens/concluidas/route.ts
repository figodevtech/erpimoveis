// app/api/ordens/concluidas/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { idDeBusca } from "@/lib/busca-numerica";

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const page = Math.max(Number(searchParams.get("page") ?? 1), 1);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 20), 1), 200);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // Seleciona OS concluídas + joins úteis
    let sel = supabaseAdmin
      .from("ordemservico")
      .select(
        `
        id,
        descricao,
        status,
        dataentrada,
        datasaida,
        datasaidaprevista,
        cliente:clienteid ( id, nomerazaosocial ),
        veiculo:veiculoid ( id, placa, modelo, marca ),
        setor:setorid ( id, nome )
      `,
        { count: "exact" }
      )
      .eq("status", "CONCLUIDA")
      .order("datasaida", { ascending: false, nullsFirst: false })
      .range(from, to);

    // Busca básica (descricao e id numérico)
    if (q) {
      const asNumber = idDeBusca(q);
      if (asNumber !== null) {
        sel = sel.or(`id.eq.${asNumber},descricao.ilike.%${q}%`);
      } else {
        sel = sel.ilike("descricao", `%${q}%`);
      }
    }

    const { data, error, count } = await sel;
    if (error) throw error;

    const items = (data ?? []).map((r: any) => ({
      id: r.id,
      numero: `OS-${String(r.id).padStart(3, "0")}`,
      cliente: r.cliente?.nomerazaosocial ?? "—",
      veiculo: r.veiculo ? `${r.veiculo.modelo} - ${r.veiculo.placa}` : "—",
      descricao: r.descricao ?? "—",
      status: r.status ?? "CONCLUIDA",
      tecnico: "—", // se quiser, adicione campo técnico na tabela/consulta
      criadaEm: r.dataentrada ?? null,
      concluidaEm: r.datasaida ?? null,
      temProdutos: false, // pode ser calculado depois (ex: existe registro em osproduto?)
      setor: r.setor?.nome ?? null,
    }));

    return NextResponse.json({
      items,
      page,
      limit,
      total: count ?? 0,
    });
  } catch (e: any) {
    const msg = e?.message ?? "Erro ao listar OS concluídas";
    const status = /nao autentic|não autentic|unauth/i.test(msg) ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
