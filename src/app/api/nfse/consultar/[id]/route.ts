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

    // 2. Call Focus NFe API
    const { data: empresa } = await supabaseAdmin.from("empresa").select("ambiente").limit(1).single();
    const nfseService = new NFSeService();
    if (empresa) nfseService.configurarAmbiente(empresa.ambiente);

    const modelo = nfsDb.modelo_emissao === "NACIONAL" ? "NACIONAL" : "MUNICIPAL";
    const resultado = await nfseService.consultar(nfsDb.referencia, modelo);

    // 3. Update DB state
    if (resultado.ok) {
        // Focus NFe returns status like "autorizado", "cancelado", "erro_autorizacao", "processando_autorizacao"
        const finalStatus = (resultado.status || "PROCESSANDO").toUpperCase();
        
        await supabaseAdmin
            .from("nfse")
            .update({
                status: finalStatus,
                url_pdf: resultado.url || nfsDb.url_pdf || null,
                erros: resultado.erros && resultado.erros.length > 0 ? resultado.erros : null,
                protocolo: resultado.codigo_verificacao || nfsDb.protocolo || null,
                numero: resultado.numero || nfsDb.numero || null
            })
            .eq("id", dbId);
            
        return NextResponse.json(
            { ok: true, status: finalStatus, message: "Consulta realizada com sucesso." },
            { status: 200 }
        );
    } else {
        // Log query error but don't strictly fail the DB record unless its an auth error, we just update error log
        const newErros = resultado.erros && resultado.erros.length > 0 ? resultado.erros : null;
        if (newErros) {
            await supabaseAdmin
                .from("nfse")
                .update({ erros: newErros })
                .eq("id", dbId);
        }

        return NextResponse.json(
            { ok: false, message: resultado.message || "Falha na comunicação com a API Focus NFS-e.", erros: newErros },
            { status: 400 }
        );
    }

  } catch (e: any) {
    console.error("[POST /api/nfse/consultar] exception", e);
    return NextResponse.json(
      { ok: false, message: "Erro inesperado ao consultar NFS-e." },
      { status: 500 }
    );
  }
}
