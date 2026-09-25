// app/api/checklists/images/[imageId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import { requireOSEdit } from "@/app/api/_authz/perms";

const BUCKET = "vistoria";

/** Extrai o path no bucket a partir da URL pública */
function storagePathFromPublicUrl(url: string) {
  try {
    const u = new URL(url);
    // caminhos do storage normalmente têm /object/public/<bucket>/<path>
    const marker = `/object/public/${BUCKET}/`;
    const i = u.pathname.indexOf(marker);
    if (i === -1) return null;
    return u.pathname.slice(i + marker.length);
  } catch {
    return null;
  }
}

type Params = { imageId: string; checklistId: string };

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<Params> } // <- Next 15: params é Promise
) {
  try {
    await requireOSEdit();
    const { imageId, checklistId } = await context.params;

    const idNum = Number(imageId);
    if (!Number.isFinite(idNum)) {
      return NextResponse.json({ error: "imageId inválido" }, { status: 400 });
    }

    // Busca para descobrir a URL antes de apagar
    const { data: row, error: selErr } = await supabaseAdmin
      .from("imagemvistoria")
      .select("id, url")
      .eq("id", idNum).eq("checklistid", Number(checklistId))
      .single();

    if (selErr || !row) {
      return NextResponse.json(
        { error: selErr?.message || "Imagem não encontrada" },
        { status: 404 }
      );
    }

    // Apaga o registro no banco
    const { error: delErr } = await supabaseAdmin
      .from("imagemvistoria")
      .delete()
      .eq("id", idNum).eq("checklistid", Number(checklistId));

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    // (Opcional) tenta apagar o arquivo do Storage
    const path = storagePathFromPublicUrl(row.url as string);
    if (path) {
      const { error: stErr } = await supabaseAdmin.storage.from(BUCKET).remove([path]);
      if (stErr) {
        // não falha a requisição por causa do storage; apenas loga
        console.warn("Falha ao remover do Storage:", stErr.message);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[DELETE] /api/checklists/images/[imageId]", err);
    return NextResponse.json(
      { error: err?.message ?? "Erro inesperado ao excluir imagem" },
      { status: 500 }
    );
  }
}
