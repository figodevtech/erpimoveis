import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const osId = Number(id);

    if (!Number.isFinite(osId) || osId <= 0) {
      return NextResponse.json(
        { ok: false, message: "ID da OS inválido." },
        { status: 400 }
      );
    }

    // Colunas nomeadas de proposito: payload_enviado e retorno_bruto existem
    // para diagnostico no banco e nao tem uso nesta tela, entao nao viajam ate
    // o navegador a cada abertura do dialogo.
    const { data: nfses, error } = await supabaseAdmin
      .from("nfse")
      .select(
        "id, ordemservicoid, clienteid, empresaid, numero, referencia, status, protocolo, valor_total, erros, dataemissao, createdat, updatedat, url_pdf, url_consulta, modelo_emissao",
      )
      .eq("ordemservicoid", osId)
      .order("createdat", { ascending: false });

    if (error) {
      console.error("[GET /api/nfse/por-os]", error);
      return NextResponse.json(
        { ok: false, message: "Erro ao buscar NFS-e." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, osId, nfses: nfses || [] }, { status: 200 });
  } catch (e: any) {
    console.error("[GET /api/nfse/por-os] exception", e);
    return NextResponse.json(
      { ok: false, message: "Erro inesperado ao buscar NFS-e." },
      { status: 500 }
    );
  }
}
