import { NextResponse } from "next/server";

import { requireConfigEdit } from "@/app/api/_authz/perms";
import { getFocusWebhookSecret } from "@/lib/focus-webhook-security";
import { FocusWebhookService } from "@/lib/services/fiscais/webhook-service";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

/** Registra os hooks na Focus. É uma mutação administrativa e aceita somente POST. */
export async function POST() {
  try {
    await requireConfigEdit();

    const { data: empresa, error: empresaError } = await supabaseAdmin
      .from("empresa")
      .select("ambiente, cnpj")
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (empresaError) throw empresaError;
    if (!empresa) {
      return NextResponse.json(
        { ok: false, message: "Empresa não encontrada para configuração." },
        { status: 404 },
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
    if (!baseUrl || !/^https:\/\//i.test(baseUrl)) {
      return NextResponse.json(
        { ok: false, message: "NEXT_PUBLIC_APP_URL HTTPS não configurada." },
        { status: 503 },
      );
    }

    const secret = getFocusWebhookSecret(empresa.ambiente);
    if (!secret) {
      return NextResponse.json(
        { ok: false, message: "Credencial de webhook da Focus não configurada." },
        { status: 503 },
      );
    }

    const callbackPath = "/api/webhooks/focus";
    const callbackUrl = `${baseUrl}${callbackPath}?secret=${encodeURIComponent(secret)}`;
    const service = new FocusWebhookService();
    service.configurarAmbiente(empresa.ambiente);

    const results = [];
    for (const event of ["nfe", "nfse", "nfsen"]) {
      const result = await service.criarHook(event, callbackUrl, empresa.cnpj);
      results.push({ event, ...result });
    }

    return NextResponse.json({
      ok: true,
      ambiente: empresa.ambiente,
      url_registrada: `${baseUrl}${callbackPath}`,
      resultados: results,
    });
  } catch (error: any) {
    const status = Number(error?.statusCode) || 500;
    console.error("[Focus Register] Falha:", error?.code ?? error?.name);
    return NextResponse.json(
      { ok: false, message: status === 403 ? "Acesso negado." : "Falha ao registrar webhooks." },
      { status },
    );
  }
}
