import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizarStatusNFSe } from "@/lib/services/fiscais/nfse-service";

export const runtime = "nodejs";

/**
 * Handler genérico para Webhooks da Focus NFe.
 * Suporta NFS-e (Serviço).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log("[Webhook Focus NFe] Recebido:", JSON.stringify(body, null, 2));

    const referencia = body.ref;
    const focusStatus = body.status;

    if (!referencia) {
      return NextResponse.json({ ok: false, message: "Webhook: referencia (ref) ausente." }, { status: 400 });
    }

    const finalStatus = normalizarStatusNFSe(focusStatus);

    // Tentar encontrar a referência na tabela 'nfse'
    const { data: nfse } = await supabaseAdmin
      .from("nfse")
      .select("id")
      .eq("referencia", referencia)
      .maybeSingle();

    if (nfse) {
      console.log(`[Webhook Focus NFe] Atualizando NFS-e ID: ${nfse.id} para status: ${finalStatus}`);
      
      const updatePayload: any = {
        status: finalStatus,
        numero: body.numero || undefined,
        protocolo: body.codigo_verificacao || body.protocolo || undefined,
        url_pdf: body.url || body.caminho_danfe || undefined,
        url_xml: body.caminho_xml_nota_fiscal || undefined,
        erros: body.erros || (body.mensagem_sefaz ? [{ mensagem: body.mensagem_sefaz, codigo: body.status_sefaz }] : null),
        updatedat: new Date().toISOString(),
      };

      // Limpa campos undefined
      Object.keys(updatePayload).forEach(key => updatePayload[key] === undefined && delete updatePayload[key]);

      const { error: updError } = await supabaseAdmin
        .from("nfse")
        .update(updatePayload)
        .eq("id", nfse.id);

      if (updError) throw updError;
      
      return NextResponse.json({ ok: true });
    }

    // Se não encontrou nada na 'nfse', ignoramos
    console.warn(`[Webhook Focus NFe] Referência não encontrada no sistema: ${referencia}`);
    return NextResponse.json({ ok: true, message: "Referência não vinculada a registros ativos." });

  } catch (e: any) {
    console.error("[Webhook Focus NFe] Exception fatal:", e);
    return NextResponse.json({ ok: true, error: e.message }, { status: 200 });
  }
}
