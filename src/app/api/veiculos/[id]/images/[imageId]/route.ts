export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireVeiculosDelete, requireVeiculosEdit } from "@/app/api/_authz/perms";

type Params = { id: string; imageId: string };

const BUCKET = "veiculo_imagem";

async function parseParams(context: { params: Promise<Params> }) {
  const { id, imageId } = await context.params;

  const veiculoId = Number((id ?? "").trim());
  const imgId = Number((imageId ?? "").trim());

  if (!Number.isInteger(veiculoId) || veiculoId <= 0) throw new Error("ID invalido.");
  if (!Number.isInteger(imgId) || imgId <= 0) throw new Error("Imagem invalida.");

  return { veiculoId, imgId };
}

export async function PATCH(req: NextRequest, context: { params: Promise<Params> }) {
  try {
    await requireVeiculosEdit();
    const { veiculoId, imgId } = await parseParams(context);
    const body = await req.json().catch(() => ({}));

    if (body?.principal !== true) {
      return NextResponse.json({ error: "Envie { principal: true }" }, { status: 400 });
    }

    const { data: img, error } = await supabaseAdmin
      .from("veiculo_imagem")
      .select("id, veiculo_id, url")
      .eq("id", imgId)
      .eq("veiculo_id", veiculoId)
      .single();

    if (error || !img) {
      return NextResponse.json({ error: "Imagem nao encontrada." }, { status: 404 });
    }

    const { error: updErr } = await supabaseAdmin
      .from("veiculo")
      .update({ imgUrl: img.url, updatedat: new Date().toISOString() })
      .eq("id", veiculoId);

    if (updErr) {
      console.error("[PATCH veiculo image principal] update veiculo error:", updErr);
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    console.error("[PATCH veiculo image principal] exception:", e);
    return NextResponse.json({ error: e?.message ?? "Erro ao definir imagem principal" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: { params: Promise<Params> }) {
  try {
    await requireVeiculosDelete();
    const { veiculoId, imgId } = await parseParams(context);

    const { data: img, error } = await supabaseAdmin
      .from("veiculo_imagem")
      .select("id, veiculo_id, url, path")
      .eq("id", imgId)
      .eq("veiculo_id", veiculoId)
      .single();

    if (error || !img) {
      return NextResponse.json({ error: "Imagem nao encontrada." }, { status: 404 });
    }

    if (img.path) {
      const { error: rmErr } = await supabaseAdmin.storage.from(BUCKET).remove([img.path]);
      if (rmErr) {
        console.error("[DELETE veiculo image] storage remove error:", rmErr);
        return NextResponse.json({ error: rmErr.message, where: "storage.remove", bucket: BUCKET }, { status: 500 });
      }
    }

    const { error: delErr } = await supabaseAdmin.from("veiculo_imagem").delete().eq("id", imgId);
    if (delErr) {
      console.error("[DELETE veiculo image] db delete error:", delErr);
      return NextResponse.json({ error: delErr.message, where: "db.delete veiculo_imagem" }, { status: 500 });
    }

    const { data: veiculo, error: veiculoErr } = await supabaseAdmin
      .from("veiculo")
      .select('id, "imgUrl"')
      .eq("id", veiculoId)
      .single();

    if (!veiculoErr && veiculo?.imgUrl === img.url) {
      const { data: nextImg } = await supabaseAdmin
        .from("veiculo_imagem")
        .select("url")
        .eq("veiculo_id", veiculoId)
        .order("ordem", { ascending: true })
        .limit(1)
        .maybeSingle();

      await supabaseAdmin
        .from("veiculo")
        .update({ imgUrl: nextImg?.url ?? null, updatedat: new Date().toISOString() })
        .eq("id", veiculoId);
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    console.error("[DELETE veiculo image] exception:", e);
    return NextResponse.json({ error: e?.message ?? "Erro ao remover imagem" }, { status: 500 });
  }
}
