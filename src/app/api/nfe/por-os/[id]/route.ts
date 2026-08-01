// src/app/api/nfe/por-os/[id]/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const osId = Number(id);

  if (!Number.isFinite(osId) || osId <= 0) {
    return NextResponse.json(
      { ok: false, message: "ID da OS inválido." },
      { status: 400 }
    );
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("nfe")
      .select(
        [
          "id",
          "modelo",
          "serie",
          "numero",
          "chave_acesso",
          "ambiente",
          "status",
          "ordemservicoid",
          "vendaid",
          "clienteid",
          "dataemissao",
          "dataautorizacao",
          "protocolo",
          "total_produtos",
          "total_servicos",
          "total_nfe",
          "justificativacancelamento",
          "codigo_rejeicao",
          "motivo_rejeicao",
          "rejeitada_em",
          "createdat",
          "updatedat",
          "empresaid",
        ].join(", ")
      )
      .eq("ordemservicoid", osId)
      .order("createdat", { ascending: false });

    if (error) {
      console.error("[GET /api/nfe/por-os]", error);
      return NextResponse.json(
        {
          ok: false,
          message: "Erro ao buscar NF-e vinculadas à OS.",
          error: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        osId,
        nfes: data ?? [],
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    console.error("[GET /api/nfe/por-os] exception", e);
    return NextResponse.json(
      {
        ok: false,
        message: "Erro inesperado ao buscar NF-e da OS.",
      },
      { status: 500 }
    );
  }
}
