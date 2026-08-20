import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

/** Somente os dados nao secretos necessarios para decidir o fluxo de emissao. */
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("empresa")
    .select("ambiente, codigomunicipio, regimetributario")
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("GET /api/fiscal/empresa-contexto", error.code);
    return NextResponse.json(
      { ok: false, error: "Falha ao carregar contexto fiscal da empresa." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { ok: true, empresa: data ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
