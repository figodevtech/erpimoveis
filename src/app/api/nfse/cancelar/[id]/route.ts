import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { NFSeService, normalizarStatusNFSe } from "@/lib/services/fiscais/nfse-service";
import {
  atualizarRegistroNFSe,
  interacaoNFSe,
  registrarInteracaoNFSe,
} from "@/lib/services/fiscais/nfse-registro";
import { transportDoRegistro } from "@/lib/services/fiscais/nfse-transport";

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
    // A empresa que emitiu a nota, com o token dela. Nota antiga sem
    // `empresaid` cai na única empresa do banco, como antes.
    const consultaEmpresa = supabaseAdmin.from("empresa").select("id, ambiente");
    const { data: empresa } = nfsDb.empresaid
      ? await consultaEmpresa.eq("id", nfsDb.empresaid).maybeSingle()
      : await consultaEmpresa.order("id", { ascending: true }).limit(1).maybeSingle();
    const { data: nfseConfig } = empresa
      ? await supabaseAdmin.from("nfse_config").select("token").eq("empresa_id", empresa.id).maybeSingle()
      : { data: null };
    const nfseService = new NFSeService();
    if (empresa) nfseService.configurarAmbiente(empresa.ambiente, nfseConfig?.token);

    // Transporte da nota gravada: municipal antiga cancela em `/v2/nfse`.
    const transport = transportDoRegistro(nfsDb.modelo_emissao, nfseService);
    if (!transport.disponivel) {
      return NextResponse.json({ ok: false, message: transport.motivoIndisponivel }, { status: 409 });
    }
    const resultado = await transport.cancelar(nfsDb.referencia, justificativa);
    await registrarInteracaoNFSe(dbId, interacaoNFSe("CANCELAMENTO", nfsDb.referencia, resultado.retornoBruto, { justificativa }));

    // 3. Update DB state
    if (resultado.ok) {
        // Normally Focus returns { status: "cancelado" } if successful immediately
        const finalStatus = normalizarStatusNFSe(resultado.status, "CANCELADA");
        
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

        // Log errors on db if interesting. O retorno bruto so entra aqui: no
        // cancelamento que da certo ele apagaria o retorno da emissao, que e o
        // que interessa guardar.
        if (newErros) {
             await atualizarRegistroNFSe(
                dbId,
                { erros: newErros },
                { retorno_bruto: resultado.retornoBruto },
             );
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
