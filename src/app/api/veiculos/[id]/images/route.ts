export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  PERMS,
  requireAny,
  requireVeiculosAccess,
  requireVeiculosEdit,
} from "@/app/api/_authz/perms";

type Params = { id: string };

const BUCKET = "veiculo_imagem";

async function parseId(context: { params: Promise<Params> }) {
  const { id: idStr } = await context.params;
  const id = Number((idStr ?? "").trim());
  if (!Number.isInteger(id) || id <= 0) throw new Error("ID invalido.");
  return id;
}

export async function GET(_req: NextRequest, context: { params: Promise<Params> }) {
  try {
    await requireVeiculosAccess();
    const veiculoId = await parseId(context);

    const { data, error } = await supabaseAdmin
      .from("veiculo_imagem")
      .select("id, veiculo_id, url, ordem, createdat")
      .eq("veiculo_id", veiculoId)
      .order("ordem", { ascending: true });

    if (error) {
      console.error("[GET veiculo images] supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ imagens: data ?? [] }, { status: 200 });
  } catch (e: any) {
    console.error("[GET veiculo images] exception:", e);
    return NextResponse.json({ error: String(e?.message ?? "Erro ao listar imagens") }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<Params> }) {
  try {
    await requireVeiculosEdit();
    const veiculoId = await parseId(context);
    const body = await req.json().catch(() => ({}));
    const imageIds: number[] = Array.isArray(body?.imageIds) ? body.imageIds.map(Number) : [];

    if (imageIds.length === 0 || imageIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      return NextResponse.json({ error: "Envie imageIds validos." }, { status: 400 });
    }

    if (new Set(imageIds).size !== imageIds.length) {
      return NextResponse.json({ error: "imageIds possui itens duplicados." }, { status: 400 });
    }

    const { data: atuais, error: atuaisErr } = await supabaseAdmin
      .from("veiculo_imagem")
      .select("id, ordem")
      .eq("veiculo_id", veiculoId)
      .order("ordem", { ascending: true });

    if (atuaisErr) {
      console.error("[PATCH veiculo images order] select error:", atuaisErr);
      return NextResponse.json({ error: atuaisErr.message }, { status: 500 });
    }

    const imagensAtuais = atuais ?? [];
    const atuaisIds = new Set(imagensAtuais.map((img) => Number(img.id)));
    const contemApenasImagensDoVeiculo = imageIds.every((id) => atuaisIds.has(id));

    if (!contemApenasImagensDoVeiculo) {
      return NextResponse.json({ error: "A ordem possui imagens que nao pertencem ao veiculo." }, { status: 400 });
    }

    const enviadosIds = new Set(imageIds);
    const imageIdsOrdenados = [
      ...imageIds,
      ...imagensAtuais.map((img) => Number(img.id)).filter((id) => !enviadosIds.has(id)),
    ];

    for (const [index, imageId] of imageIdsOrdenados.entries()) {
      const { error: updErr } = await supabaseAdmin
        .from("veiculo_imagem")
        .update({ ordem: index + 1 })
        .eq("id", imageId)
        .eq("veiculo_id", veiculoId);

      if (updErr) {
        console.error("[PATCH veiculo images order] update error:", updErr);
        return NextResponse.json({ error: updErr.message }, { status: 500 });
      }
    }

    const { data, error } = await supabaseAdmin
      .from("veiculo_imagem")
      .select("id, veiculo_id, url, ordem, createdat")
      .eq("veiculo_id", veiculoId)
      .order("ordem", { ascending: true });

    if (error) {
      console.error("[PATCH veiculo images order] reload error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ imagens: data ?? [] }, { status: 200 });
  } catch (e: any) {
    console.error("[PATCH veiculo images order] exception:", e);
    return NextResponse.json({ error: String(e?.message ?? "Erro ao reordenar imagens") }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: { params: Promise<Params> }) {
  try {
    await requireAny([PERMS.VEICULOS_CRIAR, PERMS.VEICULOS_EDITAR]);
    const veiculoId = await parseId(context);

    const form = await req.formData();
    const files = form.getAll("files").filter((f) => f instanceof File) as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: "Envie arquivos em 'files'." }, { status: 400 });
    }

    if (files.length > 10) {
      return NextResponse.json({ error: "Maximo de 10 imagens por envio." }, { status: 400 });
    }

    const { default: sharp } = await import("sharp");

    const { data: ult, error: ultErr } = await supabaseAdmin
      .from("veiculo_imagem")
      .select("ordem")
      .eq("veiculo_id", veiculoId)
      .order("ordem", { ascending: false })
      .limit(1);

    if (ultErr) {
      console.error("[POST veiculo images] ultErr:", ultErr);
      return NextResponse.json({ error: String(ultErr.message), where: "select ultima ordem" }, { status: 500 });
    }

    let ordemBase = Math.max(Number(ult?.[0]?.ordem ?? 0), 0);
    const inserts: { veiculo_id: number; url: string; path: string; ordem: number }[] = [];

    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        return NextResponse.json({ error: "Todos os arquivos precisam ser imagem." }, { status: 400 });
      }

      let webp: Buffer;
      try {
        const original = Buffer.from(await file.arrayBuffer());
        webp = await sharp(original)
          .rotate()
          .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
      } catch (err: any) {
        console.error("[POST veiculo images] sharp error:", err);
        return NextResponse.json(
          { error: String(err?.message ?? "Falha ao processar imagem (sharp)"), where: "sharp" },
          { status: 500 }
        );
      }

      const path = `veiculo/${veiculoId}/${randomUUID()}.webp`;

      const { error: upErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, webp, { contentType: "image/webp", upsert: false });

      if (upErr) {
        console.error("[POST veiculo images] upload error:", upErr);
        return NextResponse.json(
          { error: String(upErr.message), where: "storage.upload", bucket: BUCKET },
          { status: 500 }
        );
      }

      const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);

      ordemBase += 1;
      inserts.push({
        veiculo_id: veiculoId,
        url: pub.publicUrl,
        path,
        ordem: ordemBase,
      });
    }

    const { data: saved, error: insErr } = await supabaseAdmin
      .from("veiculo_imagem")
      .insert(inserts)
      .select("id, veiculo_id, url, ordem, createdat, path");

    if (insErr) {
      console.error("[POST veiculo images] insert error:", insErr);
      return NextResponse.json({ error: String(insErr.message), where: "insert veiculo_imagem" }, { status: 500 });
    }

    const { data: veiculo, error: veiculoErr } = await supabaseAdmin
      .from("veiculo")
      .select('id, "imgUrl"')
      .eq("id", veiculoId)
      .single();

    if (veiculoErr) {
      console.error("[POST veiculo images] veiculo select error:", veiculoErr);
    } else if (veiculo && !veiculo.imgUrl && saved?.length) {
      const { error: updErr } = await supabaseAdmin
        .from("veiculo")
        .update({ imgUrl: saved[0].url, updatedat: new Date().toISOString() })
        .eq("id", veiculoId);

      if (updErr) console.error("[POST veiculo images] update veiculo imgUrl error:", updErr);
    }

    return NextResponse.json({ imagens: saved ?? [] }, { status: 200 });
  } catch (e: any) {
    console.error("[POST veiculo images] exception:", e);
    return NextResponse.json({ error: String(e?.message ?? "Erro ao enviar imagens") }, { status: 500 });
  }
}
