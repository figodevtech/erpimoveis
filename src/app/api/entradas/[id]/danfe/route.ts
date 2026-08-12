import { NextRequest, NextResponse } from "next/server";
import { PERMS, requireAny } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { carregarDadosDanfe } from "@/lib/nfe/danfeData";
import { gerarDanfePdf } from "@/lib/nfe/danfePdf";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(req: NextRequest, { params }: Context) {
  try {
    await requireAny([PERMS.ESTOQUE, PERMS.USOCONSUMO, PERMS.FINANCEIRO]);

    const { id } = await params;
    const entradaId = Number(id);
    const inventory = (req.nextUrl.searchParams.get("inventory") || "produto").toLowerCase();

    if (!Number.isFinite(entradaId) || entradaId <= 0) {
      return NextResponse.json({ error: "ID de entrada inválido." }, { status: 400 });
    }

    const isUsoConsumo = inventory === "usoconsumo" || inventory === "uso-consumo";
    const entradaResult = isUsoConsumo
      ? await supabaseAdmin
          .from("usoconsumo_entrada")
          .select("id,chave_nfe,numero_nota,fiscal,documento_fiscal_recebido_id")
          .eq("id", entradaId)
          .maybeSingle()
      : await supabaseAdmin
          .from("entrada")
          .select("id,notachave,numero_nota,fiscal,fiscal_dfe_documento_id")
          .eq("id", entradaId)
          .maybeSingle();
    const entrada = entradaResult.data as Record<string, unknown> | null;
    const entradaErr = entradaResult.error;

    if (entradaErr) throw entradaErr;
    if (!entrada) {
      return NextResponse.json({ error: "Entrada não encontrada." }, { status: 404 });
    }

    const chaveRaw = isUsoConsumo ? entrada.chave_nfe : entrada.notachave;
    const chave = chaveRaw ? String(chaveRaw).replace(/\D/g, "") : null;
    const numeroNota = entrada.numero_nota ? String(entrada.numero_nota).trim() : null;

    const documentoIdRaw = isUsoConsumo
      ? entrada.documento_fiscal_recebido_id
      : entrada.fiscal_dfe_documento_id;
    const documentoIdNumerico = Number(documentoIdRaw);
    let documentoId: number | null =
      Number.isInteger(documentoIdNumerico) && documentoIdNumerico > 0
        ? documentoIdNumerico
        : null;

    if (chave && chave.length === 44) {
      const { data: dfeChave } = await supabaseAdmin
        .from("fiscal_dfe_documento")
        .select("id")
        .eq("chave_acesso", chave)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (dfeChave?.id) {
        documentoId = Number(dfeChave.id);
      }
    }

    if (!documentoId && numeroNota && /^\d+$/.test(numeroNota)) {
      const numeroNormalizado = String(Number(numeroNota));
      const { data: dfeNumero } = await supabaseAdmin
        .from("fiscal_dfe_documento")
        .select("id")
        .eq("resumo->>nNF", numeroNormalizado)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (dfeNumero?.id) {
        documentoId = Number(dfeNumero.id);
      }
    }

    if (!documentoId) {
      return NextResponse.json(
        { error: "Nenhum documento fiscal registrado para esta entrada." },
        { status: 404 },
      );
    }

    const dadosDanfe = await carregarDadosDanfe(documentoId, "terceiros");
    if (!dadosDanfe || !dadosDanfe.view) {
      return NextResponse.json(
        { error: "Não foi possível carregar os dados do DANFE para este documento." },
        { status: 404 },
      );
    }

    const pdfBuffer = await gerarDanfePdf(dadosDanfe.view);
    const filename = `DANFE-${chave || numeroNota || entradaId}.pdf`;

    return new NextResponse(Buffer.from(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Erro ao gerar PDF do DANFE." },
      { status: 500 },
    );
  }
}
