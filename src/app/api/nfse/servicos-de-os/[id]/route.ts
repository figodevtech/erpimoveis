import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const osId = Number(id);

    if (!Number.isFinite(osId) || osId <= 0) {
      return NextResponse.json(
        { ok: false, message: "ID da OS inválido." },
        { status: 400 }
      );
    }

    // Busca serviços da OS
    const { data: os, error } = await supabaseAdmin
      .from("ordemservico")
      .select(`
        id,
        osservico (
          *,
          servico (*)
        )
      `)
      .eq("id", osId)
      .single();

    if (error || !os) {
      console.error("[GET /api/nfse/servicos-de-os] Erro Supabase:", error);
      return NextResponse.json(
        { ok: false, message: "Erro ao buscar serviços da OS.", error: error?.message },
        { status: 404 }
      );
    }

    // Busca Notas Fiscais de Serviço vinculadas a esta OS para verificar o status
    const { data: notas } = await supabaseAdmin
      .from("nfse")
      .select("id, referencia, status, erros, modelo_emissao")
      .eq("ordemservicoid", osId)
      .order("id", { ascending: false });

    const { data: empresa } = await supabaseAdmin
      .from("empresa")
      .select("codigomunicipio, regimetributario")
      .limit(1)
      .maybeSingle();

    const codigoMunicipio = String(empresa?.codigomunicipio || "").replace(/\D/g, "");
    const modeloEmissao = String(empresa?.regimetributario) === "4"
      ? "NACIONAL"
      : codigoMunicipio === "2503209"
        ? "MUNICIPAL_CABEDELO"
        : "MUNICIPAL_JOAO_PESSOA";

    // Mescla os dados
    const servicosMapeados = os.osservico.map((item: any) => {
      const refPattern = `OS_${os.id}_SRV_${item.servicoid}_`;
      const notaGerada = notas?.find((n: any) => n.referencia?.startsWith(refPattern));

      return {
        ...item,
        notaFiscalStatus: notaGerada ? notaGerada.status : null,
        notaFiscalId: notaGerada ? notaGerada.id : null,
        notaFiscalErros: notaGerada ? notaGerada.erros : null,
        notaFiscalModelo: notaGerada ? notaGerada.modelo_emissao : null,
      };
    });

    return NextResponse.json({
      ok: true,
      servicos: servicosMapeados,
      modeloEmissao,
      codigoMunicipio,
    });
  } catch (e: any) {
    console.error("[GET /api/nfse/servicos-de-os]", e);
    return NextResponse.json({ ok: false, message: "Erro inesperado." }, { status: 500 });
  }
}
