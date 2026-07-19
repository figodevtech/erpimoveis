import { NextResponse, type NextRequest } from "next/server";

import { PERMS, requireAny } from "@/app/api/_authz/perms";
import { buscarXmlNotaEmitida } from "@/services/fiscal/notasEmitidasService";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_req: NextRequest, { params }: Context) {
  try {
    await requireAny([PERMS.FINANCEIRO, PERMS.ORDENS, PERMS.VENDAS, PERMS.ESTOQUE]);

    const { id } = await params;
    const notaId = Number(id);

    if (!Number.isFinite(notaId) || notaId <= 0) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const nota = await buscarXmlNotaEmitida(notaId);

    if (!nota) {
      return NextResponse.json({ error: "Nota fiscal não encontrada." }, { status: 404 });
    }

    if (!nota.xml.trim()) {
      return NextResponse.json(
        { error: "Esta nota fiscal não possui XML salvo." },
        { status: 404 },
      );
    }

    const filename = `nfe-${nota.chave || nota.id}.xml`;

    return new NextResponse(nota.xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        error:
          status === 403
            ? "Você não tem permissão para baixar XML de notas fiscais."
            : "Erro ao baixar XML da nota fiscal.",
        detail: error?.message ?? String(error),
      },
      { status },
    );
  }
}
