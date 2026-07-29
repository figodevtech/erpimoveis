// src/app/api/config/nfe/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";

export const revalidate = 0;
export const dynamic = "force-dynamic";

const EMPRESA_ID = 1;

export async function GET() {
  try {
    const emp = await supabase
      .from("empresa")
      .select("cschomologacao, cscproducao")
      .eq("id", EMPRESA_ID)
      .maybeSingle();
    if (emp.error) throw emp.error;

    // Tenta ler nfe_config (se não existir, ignora e devolve defaults)
    let serie_nfe = "", serie_nfce = "", id_csc = "", natureza_operacao = "";
    try {
      const nfe = await supabase
        .from("nfe_config")
        .select("serie_nfe, serie_nfce, id_csc, natureza_operacao")
        .eq("empresa_id", EMPRESA_ID)
        .maybeSingle();
      if (nfe.data) {
        serie_nfe = nfe.data.serie_nfe ?? "";
        serie_nfce = nfe.data.serie_nfce ?? "";
        id_csc = nfe.data.id_csc ?? "";
        natureza_operacao = nfe.data.natureza_operacao ?? "";
      }
    } catch (error) {
      console.log(error)
    }

    return NextResponse.json({
      serieNFe: serie_nfe,
      serieNFCe: serie_nfce,
      idCSC: id_csc,
      naturezaOperacao: natureza_operacao,
      cscHomologacao: emp.data?.cschomologacao ?? "",
      cscProducao: emp.data?.cscproducao ?? "",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    console.error("GET /api/config/nfe", e);
    return NextResponse.json({ error: "Falha ao carregar NFe" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const nfe = body?.nfe || {};

    // Atualiza CSCs em 'empresa'
    const upEmp = await supabase
      .from("empresa")
      .update({
        cschomologacao: nfe.cscHomologacao ?? null,
        cscproducao: nfe.cscProducao ?? null,
      })
      .eq("id", EMPRESA_ID);
    if (upEmp.error) throw upEmp.error;

    // Upsert em 'nfe_config' (se tabela existir)
    let saved: any = null;
    try {
      const upNfe = await supabase
        .from("nfe_config")
        .upsert({
          empresa_id: EMPRESA_ID,
          serie_nfe: nfe.serieNFe ?? null,
          serie_nfce: nfe.serieNFCe ?? null,
          id_csc: nfe.idCSC ?? null,
          natureza_operacao: nfe.naturezaOperacao ?? null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "empresa_id" })
        .select("*")
        .maybeSingle();
      if (upNfe.error) throw upNfe.error;
      saved = upNfe.data;
    } catch (error) {
      console.log(error)
      // se tabela não existir, apenas segue (CSCs já foram salvos)
    }

    return NextResponse.json({
      ok: true,
      nfe: {
        serieNFe: saved?.serie_nfe ?? nfe.serieNFe ?? "",
        serieNFCe: saved?.serie_nfce ?? nfe.serieNFCe ?? "",
        idCSC: saved?.id_csc ?? nfe.idCSC ?? "",
        naturezaOperacao: saved?.natureza_operacao ?? nfe.naturezaOperacao ?? "",
        cscHomologacao: nfe.cscHomologacao ?? "",
        cscProducao: nfe.cscProducao ?? "",
      },
    });
  } catch (e: any) {
    console.error("PUT /api/config/nfe", e);
    return NextResponse.json({ error: "Falha ao salvar NFe" }, { status: 500 });
  }
}
