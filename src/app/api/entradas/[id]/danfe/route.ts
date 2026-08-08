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
    const inventory = req.nextUrl.searchParams.get("inventory") || "produto";

    if (!Number.isFinite(entradaId) || entradaId <= 0) {
      return NextResponse.json({ error: "ID de entrada inválido." }, { status: 400 });
    }

    const table = inventory === "usoconsumo" ? "usoconsumo_entrada" : "entrada";
    const { data: entrada, error: entradaErr } = await supabaseAdmin
      .from(table)
      .select("id, notachave, numero_nota, fiscal")
      .eq("id", entradaId)
      .maybeSingle();

    if (entradaErr) throw entradaErr;
    if (!entrada) {
      return NextResponse.json({ error: "Entrada não encontrada." }, { status: 404 });
    }

    const chave = entrada.notachave ? String(entrada.notachave).replace(/\D/g, "") : null;
    const numeroNota = entrada.numero_nota ? String(entrada.numero_nota).trim() : null;

    let documentoId: number | null = null;

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

    if (!documentoId && numeroNota) {
      const { data: dfeNumero } = await supabaseAdmin
        .from("fiscal_dfe_documento")
        .select("id")
        .or(`resumo->>numeroNota.eq.${numeroNota},chave_acesso.like.%${numeroNota}%`)
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
