import { NextResponse, type NextRequest } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { buscarXmlDfeRecebida } from "@/services/fiscal/dfeRecebidasService";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_req: NextRequest, { params }: Context) {
  try {
    await requireFinanceirosAccess();

    const { id } = await params;
    const documentoId = Number(id);

    if (!Number.isFinite(documentoId) || documentoId <= 0) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const documento = await buscarXmlDfeRecebida(documentoId);

    if (!documento) {
      return NextResponse.json({ error: "Documento fiscal não encontrado." }, { status: 404 });
    }

    if (!documento.xml.trim()) {
      return NextResponse.json({ error: "Documento fiscal sem XML salvo." }, { status: 404 });
    }

    const isCompleto = documento.completo !== false;
    const filenamePrefix = isCompleto ? "dfe" : "resumo-dfe";

    return new NextResponse(documento.xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filenamePrefix}-${documento.chave || documento.id}.xml"`,
        "X-DFe-Xml-Completo": String(isCompleto),
        "X-DFe-Xml-Motivo": encodeURIComponent(documento.motivo ?? ""),
        "X-DFe-Xml-Next-Check-After": documento.nextCheckAfter ?? "",
      },
    });
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        error:
          status === 403
            ? "Você não tem permissão para baixar XML de notas fiscais recebidas."
            : "Erro ao baixar XML do documento fiscal.",
        detail: error?.message ?? String(error),
      },
      { status },
    );
  }
}
