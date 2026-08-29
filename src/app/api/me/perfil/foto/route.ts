export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import sharp from "sharp";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  FOTO_PERFIL_BUCKET,
  FOTO_PERFIL_OUTPUT_SIZE,
  criarPathFotoPerfil,
  pathAnteriorPertenceAoUsuario,
  validarFotoSelecionada,
} from "@/lib/meu-perfil/foto-perfil";
import { getMeUserId, isNextResponse } from "../../_helpers";

export async function POST(req: Request) {
  const usuarioId = await getMeUserId(req);
  if (isNextResponse(usuarioId)) return usuarioId;

  let novoPath: string | null = null;

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Selecione uma imagem." }, { status: 400 });
    }

    const erroValidacao = validarFotoSelecionada(file);
    if (erroValidacao) {
      return NextResponse.json({ error: erroValidacao.mensagem }, { status: erroValidacao.status });
    }

    const { data: usuario, error: usuarioError } = await supabaseAdmin
      .from("usuario")
      .select("id, foto_path")
      .eq("id", usuarioId)
      .maybeSingle();
    if (usuarioError) throw usuarioError;
    if (!usuario) {
      return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
    }

    let imagem: Buffer;
    try {
      imagem = await sharp(Buffer.from(await file.arrayBuffer()), {
        failOn: "error",
        limitInputPixels: 40_000_000,
      })
        .rotate()
        .resize(FOTO_PERFIL_OUTPUT_SIZE, FOTO_PERFIL_OUTPUT_SIZE, {
          fit: "cover",
          position: "attention",
        })
        .webp({ quality: 84 })
        .toBuffer();
    } catch {
      return NextResponse.json(
        { error: "Não foi possível processar esta imagem. Escolha outro arquivo." },
        { status: 400 },
      );
    }

    novoPath = criarPathFotoPerfil(usuarioId, crypto.randomUUID());
    const { error: uploadError } = await supabaseAdmin.storage
      .from(FOTO_PERFIL_BUCKET)
      .upload(novoPath, imagem, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
    if (uploadError) throw uploadError;

    const { data: publicData } = supabaseAdmin.storage.from(FOTO_PERFIL_BUCKET).getPublicUrl(novoPath);
    const fotoUrl = publicData.publicUrl;
    const { data: atualizado, error: updateError } = await supabaseAdmin
      .from("usuario")
      .update({
        foto_url: fotoUrl,
        foto_path: novoPath,
        updatedat: new Date().toISOString(),
      })
      .eq("id", usuarioId)
      .select("id, foto_url")
      .maybeSingle();

    if (updateError || !atualizado) {
      await supabaseAdmin.storage.from(FOTO_PERFIL_BUCKET).remove([novoPath]);
      novoPath = null;
      if (updateError) throw updateError;
      return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
    }

    const pathAnterior = (usuario as { foto_path?: unknown }).foto_path;
    if (pathAnteriorPertenceAoUsuario(pathAnterior, usuarioId) && pathAnterior !== novoPath) {
      const { error: removeError } = await supabaseAdmin.storage
        .from(FOTO_PERFIL_BUCKET)
        .remove([pathAnterior]);
      if (removeError) {
        console.warn("[POST /api/me/perfil/foto] não foi possível remover a foto anterior", removeError);
      }
    }

    return NextResponse.json(
      { fotoUrl: String(atualizado.foto_url) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (novoPath) {
      await supabaseAdmin.storage.from(FOTO_PERFIL_BUCKET).remove([novoPath]).catch(() => undefined);
    }
    console.error("[POST /api/me/perfil/foto]", error);
    return NextResponse.json({ error: "Não foi possível salvar a foto do perfil." }, { status: 500 });
  }
}
