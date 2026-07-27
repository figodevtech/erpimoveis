import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { FocusWebhookService } from "@/lib/services/fiscais/webhook-service";

export const runtime = "nodejs";

/**
 * GET /api/webhooks/focus/register
 * Rota para registrar os hooks na Focus NFe.
 */
export async function GET(req: Request) {
  try {
    // 1. Buscar ambiente da empresa
    const { data: empresa, error: empError } = await supabaseAdmin
      .from("empresa")
      .select("ambiente, cnpj")
      .limit(1)
      .single();

    if (empError || !empresa) {
      return NextResponse.json({ ok: false, message: "Empresa não encontrada para configuração." }, { status: 404 });
    }

    // 2. Determinar URL de callback
    let baseUrl = process.env.NEXT_PUBLIC_APP_URL || "";
    if (!baseUrl) {
      const host = req.headers.get("host");
      const protocol = host?.includes("localhost") ? "http" : "https";
      baseUrl = `${protocol}://${host}`;
    }
    
    baseUrl = baseUrl.replace(/\/$/, "");
    const callbackUrl = `${baseUrl}/api/webhooks/focus`;

    const service = new FocusWebhookService();
    service.configurarAmbiente(empresa.ambiente);

    console.log(`[Focus Register] Iniciando registro em ${empresa.ambiente} para ${callbackUrl}`);

    // 3. Registrar hooks para NFe e NFSe
    const events = ["nfe", "nfse", "nfsen"];
    const results = [];

    for (const event of events) {
      const res = await service.criarHook(event, callbackUrl, empresa.cnpj);
      results.push({ event, ...res });
    }

    return NextResponse.json({
      ok: true,
      ambiente: empresa.ambiente,
      url_registrada: callbackUrl,
      resultados: results
    });

  } catch (e: any) {
    console.error("[Focus Register] Erro fatal:", e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
