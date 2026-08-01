import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const vendaId = Number(id);

  if (!Number.isFinite(vendaId) || vendaId <= 0) {
    return NextResponse.json(
      { ok: false, message: "ID da venda inválido." },
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
          "xml_assinado",
          "xml_autorizado",
          "justificativacancelamento",
          "codigo_rejeicao",
          "motivo_rejeicao",
          "rejeitada_em",
          "createdat",
          "updatedat",
          "empresaid",
        ].join(", ")
      )
      .eq("vendaid", vendaId)
      .order("createdat", { ascending: false });

    if (error) {
      console.error("[GET /api/nfe/por-venda]", error);
      return NextResponse.json(
        {
          ok: false,
          message: "Erro ao buscar NF-e vinculadas à venda.",
          error: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        vendaId,
        nfes: data ?? [],
      },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("[GET /api/nfe/por-venda] exception", e);
    return NextResponse.json(
      {
        ok: false,
        message: "Erro inesperado ao buscar NF-e da venda.",
      },
      { status: 500 }
    );
  }
}
