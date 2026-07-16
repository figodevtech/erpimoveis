export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireDesmancheDelete, requireDesmancheEdit } from "@/app/api/_authz/perms";

type Params = { id: string; imageId: string };

const BUCKET = "lote_imagem";

async function parseParams(context: { params: Promise<Params> }) {
  const { id, imageId } = await context.params;

  const loteId = Number((id ?? "").trim());
  const imgId = Number((imageId ?? "").trim());

  if (!Number.isInteger(loteId) || loteId <= 0) throw new Error("ID invalido.");
  if (!Number.isInteger(imgId) || imgId <= 0) throw new Error("Imagem invalida.");

  return { loteId, imgId };
}

export async function PATCH(req: NextRequest, context: { params: Promise<Params> }) {
  try {
    await requireDesmancheEdit();
    const { loteId, imgId } = await parseParams(context);
    const body = await req.json().catch(() => ({}));

    if (body?.principal !== true) {
      return NextResponse.json({ error: "Envie { principal: true }" }, { status: 400 });
    }

    const { data: img, error } = await supabaseAdmin
      .from("lote_imagem")
      .select("id, lote_id, url")
      .eq("id", imgId)
      .eq("lote_id", loteId)
      .single();

    if (error || !img) {
      return NextResponse.json({ error: "Imagem nao encontrada." }, { status: 404 });
    }

    const { error: updErr } = await supabaseAdmin
      .from("lotes")
      .update({ imgUrl: img.url, updatedat: new Date().toISOString() })
      .eq("id", loteId);

    if (updErr) {
      console.error("[PATCH lote image principal] update lote error:", updErr);
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    console.error("[PATCH lote image principal] exception:", e);
    return NextResponse.json(
      { error: e?.message ?? "Erro ao definir imagem principal" },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: NextRequest, context: { params: Promise<Params> }) {
  try {
    await requireDesmancheDelete();
    const { loteId, imgId } = await parseParams(context);

    const { data: img, error } = await supabaseAdmin
      .from("lote_imagem")
      .select("id, lote_id, url, path")
      .eq("id", imgId)
      .eq("lote_id", loteId)
      .single();

    if (error || !img) {
      return NextResponse.json({ error: "Imagem nao encontrada." }, { status: 404 });
    }

    if (img.path) {
      const { error: rmErr } = await supabaseAdmin.storage.from(BUCKET).remove([img.path]);
      if (rmErr) {
        console.error("[DELETE lote image] storage remove error:", rmErr);
        return NextResponse.json(
          { error: rmErr.message, where: "storage.remove", bucket: BUCKET },
          { status: 500 },
        );
      }
    }

    const { error: delErr } = await supabaseAdmin.from("lote_imagem").delete().eq("id", imgId);
    if (delErr) {
      console.error("[DELETE lote image] db delete error:", delErr);
      return NextResponse.json(
        { error: delErr.message, where: "db.delete lote_imagem" },
        { status: 500 },
      );
    }

    const { data: lote, error: loteErr } = await supabaseAdmin
      .from("lotes")
      .select('id, "imgUrl"')
      .eq("id", loteId)
      .single();

    if (!loteErr && lote?.imgUrl === img.url) {
      const { data: nextImg } = await supabaseAdmin
        .from("lote_imagem")
        .select("url")
        .eq("lote_id", loteId)
        .order("ordem", { ascending: true })
        .limit(1)
        .maybeSingle();

      await supabaseAdmin
        .from("lotes")
        .update({ imgUrl: nextImg?.url ?? null, updatedat: new Date().toISOString() })
        .eq("id", loteId);
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    console.error("[DELETE lote image] exception:", e);
    return NextResponse.json({ error: e?.message ?? "Erro ao remover imagem" }, { status: 500 });
  }
}
