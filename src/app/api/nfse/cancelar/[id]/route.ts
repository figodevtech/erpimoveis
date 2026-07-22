import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { NFSeService } from "@/lib/services/fiscais/nfse-service";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const dbId = Number(id);

    if (!Number.isFinite(dbId) || dbId <= 0) {
      return NextResponse.json(
        { ok: false, message: "ID de NFS-e inválido." },
        { status: 400 }
      );
    }

    const { justificativa } = await req.json().catch(() => ({ justificativa: null }));

    if (!justificativa || justificativa.length < 15) {
      return NextResponse.json(
        { ok: false, message: "A justificativa deve conter no mínimo 15 caracteres para cancelar a nota no município." },
        { status: 400 }
      );
    }

    // 1. Fetch DB record
    const { data: nfsDb, error: fetchErr } = await supabaseAdmin
      .from("nfse")
      .select("*")
      .eq("id", dbId)
      .single();

    if (fetchErr || !nfsDb) {
      return NextResponse.json(
        { ok: false, message: "NFS-e não encontrada." },
        { status: 404 }
      );
    }

    // 2. Cancel on Focus NFe
    const { data: empresa } = await supabaseAdmin.from("empresa").select("ambiente").limit(1).single();
    const nfseService = new NFSeService();
    if (empresa) nfseService.configurarAmbiente(empresa.ambiente);

    const modelo = nfsDb.modelo_emissao === "NACIONAL" ? "NACIONAL" : "MUNICIPAL";
    const resultado = await nfseService.cancelar(nfsDb.referencia, justificativa, modelo);

    // 3. Update DB state
    if (resultado.ok) {
        // Normally Focus returns { status: "cancelado" } if successful immediately
        const finalStatus = (resultado.status || "CANCELADA").toUpperCase();
        
        await supabaseAdmin
            .from("nfse")
            .update({
                status: finalStatus,
            })
            .eq("id", dbId);
            
        return NextResponse.json(
            { ok: true, message: "NFS-e enviada para cancelamento com sucesso." },
            { status: 200 }
        );
    } else {
        const newErros = resultado.erros && resultado.erros.length > 0 ? resultado.erros : null;
        
        // Log errors on db if interesting
        if (newErros) {
             await supabaseAdmin
                .from("nfse")
                .update({ erros: newErros })
                .eq("id", dbId);
        }

        return NextResponse.json(
            { ok: false, message: resultado.message || "Falha ao cancelar na API Focus.", erros: newErros || null },
            { status: 400 }
        );
    }

  } catch (e: any) {
    console.error("[POST /api/nfse/cancelar] exception", e);
    return NextResponse.json(
      { ok: false, message: "Erro inesperado interno ao cancelar NFS-e." },
      { status: 500 }
    );
  }
}
