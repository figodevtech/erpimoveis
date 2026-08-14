import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { syncNfseWithFocus } from "@/lib/services/fiscais/nfse-sync";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function POST(_req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const dbId = Number(id);

    if (!Number.isFinite(dbId) || dbId <= 0) {
      return NextResponse.json(
        { ok: false, message: "ID de NFS-e inválido." },
        { status: 400 }
      );
    }

    // 1. Fetch DB record to get 'referencia'
    const { data: nfsDb, error: fetchErr } = await supabaseAdmin
      .from("nfse")
      .select("*")
      .eq("id", dbId)
      .single();

    if (fetchErr || !nfsDb) {
      return NextResponse.json(
        { ok: false, message: "NFS-e não encontrada no banco de dados." },
        { status: 404 }
      );
    }

    if (!nfsDb.referencia) {
         return NextResponse.json(
             { ok: false, message: "A referêcia da NFS-e é nula no banco de dados." },
             { status: 400 }
           );
    }

    const result = await syncNfseWithFocus(nfsDb);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, message: result.message, erros: result.errors ?? null },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { ok: true, status: result.status, message: "Consulta realizada com sucesso." },
      { status: 200 },
    );

  } catch (e: any) {
    console.error("[POST /api/nfse/consultar] exception", e);
    return NextResponse.json(
      { ok: false, message: "Erro inesperado ao consultar NFS-e." },
      { status: 500 }
    );
  }
}
