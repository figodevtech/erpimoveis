import { NextResponse, type NextRequest } from "next/server";

import { isValidFocusWebhookSecret } from "@/lib/focus-webhook-security";
import { extractNfseUrls } from "@/lib/nfse-urls";
import { normalizarStatusNFSe } from "@/lib/services/fiscais/nfse-service";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const MAX_WEBHOOK_BYTES = 256 * 1024;

export async function POST(req: NextRequest) {
  const receivedSecret =
    req.headers.get("x-focus-webhook-secret") ??
    req.nextUrl.searchParams.get("secret");

  if (!isValidFocusWebhookSecret(receivedSecret)) {
    return NextResponse.json(
      { ok: false, message: "Webhook não autorizado." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ ok: false, message: "Payload muito grande." }, { status: 413 });
  }

  try {
    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) {
      return NextResponse.json({ ok: false, message: "Payload muito grande." }, { status: 413 });
    }

    const body = JSON.parse(rawBody) as Record<string, any>;
    const referencia = String(body.ref ?? "").trim();
    const focusStatus = String(body.status ?? "").trim();

    if (!referencia || referencia.length > 128 || focusStatus.length > 64) {
      return NextResponse.json(
        { ok: false, message: "Payload do webhook inválido." },
        { status: 400 },
      );
    }

    const finalStatus = normalizarStatusNFSe(focusStatus);
    const { data: nfse, error: findError } = await supabaseAdmin
      .from("nfse")
      .select("id")
      .eq("referencia", referencia)
      .maybeSingle();

    if (findError) throw findError;
    if (!nfse) {
      console.warn("[Webhook Focus NFe] Referência não vinculada.");
      return NextResponse.json({ ok: true });
    }

    const urls = extractNfseUrls(body);
    const updatePayload: Record<string, unknown> = {
      status: finalStatus,
      numero: body.numero || undefined,
      protocolo: body.codigo_verificacao || body.protocolo || undefined,
      url_consulta: urls.consultationUrl || undefined,
      url_pdf: urls.pdfUrl || undefined,
      url_xml: body.caminho_xml_nota_fiscal || undefined,
      erros:
        body.erros ||
        (body.mensagem_sefaz
          ? [{ mensagem: body.mensagem_sefaz, codigo: body.status_sefaz }]
          : null),
      updatedat: new Date().toISOString(),
    };

    for (const key of Object.keys(updatePayload)) {
      if (updatePayload[key] === undefined) delete updatePayload[key];
    }

    const { error: updateError } = await supabaseAdmin
      .from("nfse")
      .update(updatePayload)
      .eq("id", nfse.id);

    if (updateError) throw updateError;
    console.info("[Webhook Focus NFe] NFS-e atualizada.", { id: nfse.id, status: finalStatus });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[Webhook Focus NFe] Falha no processamento:", error?.code ?? error?.name);
    return NextResponse.json(
      { ok: false, message: "Falha ao processar webhook." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
