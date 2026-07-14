export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireEstoqueAccess, requireEstoqueEdit } from "@/app/api/_authz/perms";

type Params = { id: string };

const BUCKET = "produto_imagem";

async function parseId(context: { params: Promise<Params> }) {
  const { id: idStr } = await context.params;
  const id = Number((idStr ?? "").trim());
  if (!Number.isInteger(id) || id <= 0) throw new Error("ID inválido.");
  return id;
}

/* ========================= GET (listar imagens) ========================= */

export async function GET(_req: NextRequest, context: { params: Promise<Params> }) {
  try {
    await requireEstoqueAccess();
    const produtoId = await parseId(context);

    const { data, error } = await supabaseAdmin
      .from("produto_imagem")
      .select("id, produto_id, url, ordem, createdat")
      .eq("produto_id", produtoId)
      .order("ordem", { ascending: true });

    if (error) {
      console.error("[GET images] supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ imagens: data ?? [] }, { status: 200 });
  } catch (e: any) {
    console.error("[GET images] exception:", e);
    return NextResponse.json({ error: String(e?.message ?? "Erro ao listar imagens") }, { status: 500 });
  }
}

/* ========================= POST (upload múltiplo) ========================= */

export async function PATCH(req: NextRequest, context: { params: Promise<Params> }) {
  try {
    await requireEstoqueEdit();
    const produtoId = await parseId(context);
    const body = await req.json().catch(() => ({}));
    const imageIds: number[] = Array.isArray(body?.imageIds) ? body.imageIds.map(Number) : [];

    if (imageIds.length === 0 || imageIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      return NextResponse.json({ error: "Envie imageIds validos." }, { status: 400 });
    }

    if (new Set(imageIds).size !== imageIds.length) {
      return NextResponse.json({ error: "imageIds possui itens duplicados." }, { status: 400 });
    }

    const { data: atuais, error: atuaisErr } = await supabaseAdmin
      .from("produto_imagem")
      .select("id, ordem")
      .eq("produto_id", produtoId)
      .order("ordem", { ascending: true });

    if (atuaisErr) {
      console.error("[PATCH images order] select error:", atuaisErr);
      return NextResponse.json({ error: atuaisErr.message }, { status: 500 });
    }

    const imagensAtuais = atuais ?? [];
    const atuaisIds = new Set(imagensAtuais.map((img) => Number(img.id)));
    const contemApenasImagensDoProduto = imageIds.every((id) => atuaisIds.has(id));

    if (!contemApenasImagensDoProduto) {
      return NextResponse.json({ error: "A ordem possui imagens que nao pertencem ao produto." }, { status: 400 });
    }

    const enviadosIds = new Set(imageIds);
    const imageIdsOrdenados = [
      ...imageIds,
      ...imagensAtuais.map((img) => Number(img.id)).filter((id) => !enviadosIds.has(id)),
    ];

    for (const [index, imageId] of imageIdsOrdenados.entries()) {
      const { error: updErr } = await supabaseAdmin
        .from("produto_imagem")
        .update({ ordem: index + 1 })
        .eq("id", imageId)
        .eq("produto_id", produtoId);

      if (updErr) {
        console.error("[PATCH images order] update error:", updErr);
        return NextResponse.json({ error: updErr.message }, { status: 500 });
      }
    }

    const { data, error } = await supabaseAdmin
      .from("produto_imagem")
      .select("id, produto_id, url, ordem, createdat")
      .eq("produto_id", produtoId)
      .order("ordem", { ascending: true });

    if (error) {
      console.error("[PATCH images order] reload error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ imagens: data ?? [] }, { status: 200 });
  } catch (e: any) {
    console.error("[PATCH images order] exception:", e);
    return NextResponse.json({ error: String(e?.message ?? "Erro ao reordenar imagens") }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: { params: Promise<Params> }) {
  try {
    await requireEstoqueEdit();
    const produtoId = await parseId(context);

    const form = await req.formData();
    const files = form.getAll("files").filter((f) => f instanceof File) as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: "Envie arquivos em 'files'." }, { status: 400 });
    }

    if (files.length > 10) {
      return NextResponse.json({ error: "Máximo de 10 imagens por envio." }, { status: 400 });
    }

    // importa sharp só aqui (evita quebrar rota inteira se sharp falhar)
    const { default: sharp } = await import("sharp");

    // última ordem
    const { data: ult, error: ultErr } = await supabaseAdmin
      .from("produto_imagem")
      .select("ordem")
      .eq("produto_id", produtoId)
      .order("ordem", { ascending: false })
      .limit(1);

    if (ultErr) {
      console.error("[POST images] ultErr:", ultErr);
      return NextResponse.json(
        { error: String(ultErr.message), where: "select ultima ordem" },
        { status: 500 }
      );
    }

    let ordemBase = Math.max(Number(ult?.[0]?.ordem ?? 0), 0);

    const inserts: { produto_id: number; url: string; path: string; ordem: number }[] = [];

    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        return NextResponse.json({ error: "Todos os arquivos precisam ser imagem." }, { status: 400 });
      }

      // processa com sharp (webp + resize)
      let webp: Buffer;
      try {
        const original = Buffer.from(await file.arrayBuffer());
        webp = await sharp(original)
          .rotate()
          .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
      } catch (err: any) {
        console.error("[POST images] sharp error:", err);
        return NextResponse.json(
          { error: String(err?.message ?? "Falha ao processar imagem (sharp)"), where: "sharp" },
          { status: 500 }
        );
      }

      // path no storage
      const path = `produto/${produtoId}/${randomUUID()}.webp`;

      const { error: upErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, webp, { contentType: "image/webp", upsert: false });

      if (upErr) {
        console.error("[POST images] upload error:", upErr);
        return NextResponse.json(
          { error: String(upErr.message), where: "storage.upload", bucket: BUCKET },
          { status: 500 }
        );
      }

      const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);

      ordemBase += 1;
      inserts.push({
        produto_id: produtoId,
        url: pub.publicUrl,
        path,
        ordem: ordemBase,
      });
    }

    const { data: saved, error: insErr } = await supabaseAdmin
      .from("produto_imagem")
      .insert(inserts)
      .select("id, produto_id, url, ordem, createdat, path");

    if (insErr) {
      console.error("[POST images] insert error:", insErr);
      return NextResponse.json({ error: String(insErr.message), where: "insert produto_imagem" }, { status: 500 });
    }

    // se produto.imgUrl estiver vazio, seta capa como a primeira imagem enviada
    const { data: prod, error: prodErr } = await supabaseAdmin
      .from("produto")
      .select('id, "imgUrl"')
      .eq("id", produtoId)
      .single();

    if (prodErr) {
      console.error("[POST images] product select error:", prodErr);
    } else if (prod && !prod.imgUrl && saved?.length) {
      const { error: updErr } = await supabaseAdmin
        .from("produto")
        .update({ imgUrl: saved[0].url, updatedat: new Date().toISOString() })
        .eq("id", produtoId);

      if (updErr) console.error("[POST images] update product imgUrl error:", updErr);
    }

    return NextResponse.json({ imagens: saved ?? [] }, { status: 200 });
  } catch (e: any) {
    console.error("[POST images] exception:", e);
    return NextResponse.json({ error: String(e?.message ?? "Erro ao enviar imagens") }, { status: 500 });
  }
}
