export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { checkLoginRateLimit, clearLoginRateLimit, registerLoginFailure } from "@/lib/login-rate-limit";
import { buildChecklistVerificationRateLimitKeys } from "@/lib/login-security";
import { checklistPublicIdValido, onlyDigits } from "@/lib/ordens/checklist-documento";
import { sha256 } from "@/lib/ordens/checklist-documento-hash";
import { checklistRequestAudit } from "@/lib/ordens/checklist-request";
import {
  downloadChecklistAsset,
  registerChecklistDocumentoEvent,
} from "@/lib/ordens/checklist-documentos-server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function equalDocument(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const keys = buildChecklistVerificationRateLimitKeys(token, request);
  const retryAfter = await checkLoginRateLimit(keys);
  if (retryAfter > 0) {
    return NextResponse.json({ error: "Muitas tentativas. Tente novamente mais tarde." }, {
      status: 429,
      headers: { "Retry-After": String(retryAfter) },
    });
  }
  const body = await request.json().catch(() => null) as any;
  const supplied = onlyDigits(body?.documento);
  if (!checklistPublicIdValido(token)) {
    await registerLoginFailure(keys);
    return NextResponse.json({ error: "Documento ou identificação inválidos." }, { status: 403 });
  }
  const documentResult = await supabaseAdmin
    .from("checklist_documento")
    .select("id,codigo")
    .eq("token_verificacao", token)
    .maybeSingle();
  if (documentResult.error || !documentResult.data) {
    await registerLoginFailure(keys);
    return NextResponse.json({ error: "Documento ou identificação inválidos." }, { status: 403 });
  }
  const [signature, file] = await Promise.all([
    supabaseAdmin.from("checklist_documento_assinatura").select("signatario_documento").eq("documento_id", documentResult.data.id).maybeSingle(),
    supabaseAdmin.from("checklist_documento_arquivo").select("storage_path,pdf_hash,tamanho_bytes").eq("documento_id", documentResult.data.id).maybeSingle(),
  ]);
  if (signature.error || file.error) {
    return NextResponse.json({ error: "Não foi possível validar o PDF." }, { status: 500 });
  }
  if (!signature.data || !file.data || !equalDocument(supplied, String(signature.data.signatario_documento))) {
    const blockedFor = await registerLoginFailure(keys);
    if (blockedFor > 0) {
      return NextResponse.json({ error: "Muitas tentativas. Tente novamente mais tarde." }, {
        status: 429,
        headers: { "Retry-After": String(blockedFor) },
      });
    }
    return NextResponse.json({ error: "Documento ou identificação inválidos." }, { status: 403 });
  }

  const bytes = await downloadChecklistAsset(String(file.data.storage_path));
  if (sha256(bytes) !== String(file.data.pdf_hash)) {
    return NextResponse.json({ error: "O arquivo oficial falhou na verificação de integridade." }, { status: 409 });
  }
  await clearLoginRateLimit([keys[0]]);
  await registerChecklistDocumentoEvent({
    documentoId: Number(documentResult.data.id),
    tipo: "PDF_PUBLICO_BAIXADO",
    audit: checklistRequestAudit(request),
  }).catch(() => undefined);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${documentResult.data.codigo}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
