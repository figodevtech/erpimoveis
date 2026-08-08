import { NextRequest, NextResponse } from "next/server";
import { PERMS, requireAny } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buscarXmlDfeRecebida } from "@/services/fiscal/dfeRecebidasService";

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

    const documento = await buscarXmlDfeRecebida(documentoId);
    if (!documento || !documento.xml || !documento.xml.trim()) {
      return NextResponse.json(
        { error: "O XML da NF-e ainda não foi disponibilizado pela SEFAZ ou não está salvo." },
        { status: 404 },
      );
    }

    const isCompleto = documento.completo !== false;
    if (!isCompleto) {
      const motivo = documento.motivo || "Aguarde a disponibilização do XML completo pela SEFAZ.";
      return NextResponse.json(
        {
          error: "XML completo indisponível",
          detail: motivo,
          xmlCompleto: false,
        },
        { status: 409 },
      );
    }

    const filename = `NFe-${documento.chave || chave || entradaId}.xml`;

    return new NextResponse(documento.xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-DFe-Xml-Completo": "true",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Erro ao consultar XML da entrada." },
      { status: 500 },
    );
  }
}
