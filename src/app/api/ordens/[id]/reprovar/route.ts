import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireOSEdit } from "@/app/api/_authz/perms";

type ParamsId = { id: string };

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<ParamsId> }
) {
  try {
    const session = await auth();
    const usuarioId = (session?.user as any)?.id as string | undefined;

    if (!usuarioId) {
      return NextResponse.json(
        { error: "Não autenticado" },
        { status: 401 }
      );
    }

    await requireOSEdit();

    const { id } = await params; // 👈 aqui também
    const osId = Number(id);

    if (!osId || Number.isNaN(osId)) {
      return NextResponse.json(
        { error: "ID de OS inválido." },
        { status: 400 }
      );
    }

    const upd = await supabaseAdmin
      .from("ordemservico")
      .update({
        statusaprovacao: "REPROVADA",
        status: "ORCAMENTO_RECUSADO",
      })
      .eq("id", osId);

    if (upd.error) throw upd.error;

    const mark = await supabaseAdmin
      .from("osaprovacao")
      .update({
        usado_em: new Date().toISOString(),
        origem: "SISTEMA",
        resultado: "REPROVADA",
        aprovador_doc: null,
        aprovador_usuario_id: usuarioId,
      })
      .eq("ordemservicoid", osId)
      .is("usado_em", null);

    if (mark.error) throw mark.error;

    return NextResponse.json(
      { ok: true, ordemservicoid: osId },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("POST /api/ordens/[id]/reprovar", err);
    return NextResponse.json(
      { error: err?.message || "Falha ao reprovar orçamento." },
      { status: Number(err?.statusCode) || 500 }
    );
  }
}
