import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizarStatusNFSe } from "@/lib/services/fiscais/nfse-service";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ id: string }>;
};

/**
 * Descarta uma NFS-e rejeitada.
 *
 * Só rejeitada. Autorizada e cancelada são documento fiscal e ficam; denegada
 * e em processamento existem do lado da prefeitura e sumiriam daqui sem sumir
 * de lá. Rejeitada é a única que a prefeitura nunca registrou -- ela não
 * consome numeração de RPS nem de nota, então apagar não deixa buraco.
 *
 * Vai junto o payload e o retorno bruto daquela tentativa, que é material de
 * diagnóstico. Só apague depois de entender por que a nota foi recusada.
 */
export async function DELETE(_req: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const nfseId = Number(String(id ?? "").trim());

    if (!Number.isInteger(nfseId) || nfseId <= 0) {
      return NextResponse.json({ ok: false, message: "NFS-e inválida." }, { status: 400 });
    }

    const { data: nfse, error: fetchError } = await supabaseAdmin
      .from("nfse")
      .select("id, status, numero")
      .eq("id", nfseId)
      .maybeSingle();

    if (fetchError) {
      console.error("[DELETE /api/nfse/excluir] Erro ao buscar NFS-e", fetchError);
      return NextResponse.json({ ok: false, message: "Erro ao buscar a NFS-e." }, { status: 500 });
    }
    if (!nfse) {
      return NextResponse.json({ ok: false, message: "NFS-e não encontrada." }, { status: 404 });
    }

    // Pela normalização: notas antigas guardam o `erro_autorizacao` cru da
    // Focus, que significa exatamente rejeitada.
    if (normalizarStatusNFSe(nfse.status) !== "REJEITADA") {
      return NextResponse.json(
        {
          ok: false,
          message: "Somente uma NFS-e rejeitada pode ser excluída.",
          statusAtual: nfse.status,
        },
        { status: 400 },
      );
    }

    const { error: deleteError } = await supabaseAdmin.from("nfse").delete().eq("id", nfseId);

    if (deleteError) {
      console.error("[DELETE /api/nfse/excluir] Erro ao excluir", deleteError);
      return NextResponse.json({ ok: false, message: "Erro ao excluir a NFS-e." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: "NFS-e rejeitada excluída." }, { status: 200 });
  } catch (error: unknown) {
    console.error("[DELETE /api/nfse/excluir] Exception", error);
    return NextResponse.json({ ok: false, message: "Erro inesperado ao excluir a NFS-e." }, { status: 500 });
  }
}
