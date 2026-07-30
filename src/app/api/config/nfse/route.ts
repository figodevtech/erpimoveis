// src/app/api/config/nfse/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";

export const revalidate = 0;
export const dynamic = "force-dynamic";

const EMPRESA_ID = 1;

export async function GET() {
  try {
    const r = await supabase
      .from("nfse_config")
      .select("*")
      .eq("empresa_id", EMPRESA_ID)
      .maybeSingle();
    if (r.error) throw r.error;

    return NextResponse.json({
      provedor: r.data?.provedor ?? "",
      inscricaoMunicipal: r.data?.inscricao_municipal ?? "",
      serieRPS: r.data?.serie_rps ?? "",
      usuario: r.data?.usuario ?? "",
      senha: r.data?.senha ?? "",
      token: r.data?.token ?? "",
      certificadoA1Base64: r.data?.certificado_a1_base64 ?? "",
      senhaCertificado: r.data?.senha_certificado ?? "",
      padroesEmissao: r.data?.padroes_emissao ?? {},
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    console.error("GET /api/config/nfse", e);
    return NextResponse.json({ error: "Falha ao carregar NFS-e" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const nfse = body?.nfse || {};

    const padroesEmissao = nfse.padroesEmissao && typeof nfse.padroesEmissao === "object"
      ? nfse.padroesEmissao
      : {};

    const up = await supabase
      .from("nfse_config")
      .upsert({
        empresa_id: EMPRESA_ID,
        provedor: nfse.provedor ?? null,
        inscricao_municipal: nfse.inscricaoMunicipal ?? null,
        serie_rps: nfse.serieRPS ?? null,
        usuario: nfse.usuario ?? null,
        senha: nfse.senha ?? null,
        token: nfse.token ?? null,
        certificado_a1_base64: nfse.certificadoA1Base64 ?? null,
        senha_certificado: nfse.senhaCertificado ?? null,
        padroes_emissao: padroesEmissao,
        updated_at: new Date().toISOString(),
      }, { onConflict: "empresa_id" })
      .select("*")
      .maybeSingle();
    if (up.error) throw up.error;

    return NextResponse.json({
      ok: true,
      nfse: {
        provedor: up.data?.provedor ?? "",
        inscricaoMunicipal: up.data?.inscricao_municipal ?? "",
        serieRPS: up.data?.serie_rps ?? "",
        usuario: up.data?.usuario ?? "",
        senha: up.data?.senha ?? "",
        token: up.data?.token ?? "",
        certificadoA1Base64: up.data?.certificado_a1_base64 ?? "",
        senhaCertificado: up.data?.senha_certificado ?? "",
        padroesEmissao: up.data?.padroes_emissao ?? {},
      },
    });
  } catch (e: any) {
    console.error("PUT /api/config/nfse", e);
    return NextResponse.json({ error: "Falha ao salvar NFS-e" }, { status: 500 });
  }
}
