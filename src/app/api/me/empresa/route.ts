import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getMeUserId, isNextResponse } from "../_helpers";

export const dynamic = "force-dynamic";

// Identificação da empresa para todos os usuários autenticados da instalação.
export async function GET() {
  const userId = await getMeUserId();
  if (isNextResponse(userId)) return userId;

  const { data, error } = await supabaseAdmin
    .from("empresa")
    .select("nomefantasia, razaosocial")
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("GET /api/me/empresa", error.code);
    return NextResponse.json(
      { error: "Falha ao carregar nome da empresa." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { nome: data?.nomefantasia?.trim() || data?.razaosocial?.trim() || null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
