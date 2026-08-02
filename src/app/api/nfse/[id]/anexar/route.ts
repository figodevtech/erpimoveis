export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { nfseEntregaPdf, nfseMotivoSemPdf } from "@/lib/nfse-modelos";

type Params = { id: string };

const BUCKET = "os_anexos";
const MAX_ANEXOS_POR_OS = 10;
const MAX_TAMANHO = 10 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

const STATUS_AUTORIZADOS = new Set(["AUTORIZADA", "AUTORIZADO", "EMITIDA"]);

async function ensureBucket() {
  const atual = await supabaseAdmin.storage.getBucket(BUCKET);
  if (!atual.error) return;

  const criado = await supabaseAdmin.storage.createBucket(BUCKET, { public: true });
  if (criado.error && !criado.error.message.toLowerCase().includes("already exists")) {
    throw criado.error;
  }
}

/**
 * Baixa a URL da nota e so aceita se for mesmo um PDF.
 *
 * A checagem por bytes e necessaria porque os portais respondem HTML (pagina de
 * consulta ou de erro) com status 200 — sem isso, salvariamos uma pagina web com
 * extensao .pdf dentro da OS.
 */
async function baixarPdf(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resposta = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!resposta.ok) {
      return { ok: false as const, message: `O portal respondeu ${resposta.status} ao baixar a NFS-e.` };
    }

    const buffer = Buffer.from(await resposta.arrayBuffer());
    if (buffer.length > MAX_TAMANHO) {
      return { ok: false as const, message: "O arquivo da NFS-e passa de 10MB." };
    }

    const assinatura = buffer.subarray(0, 5).toString("latin1");
    if (assinatura !== "%PDF-") {
      const contentType = resposta.headers.get("content-type") ?? "desconhecido";
      return {
        ok: false as const,
        message: `O endereço da NFS-e não retornou um PDF (${contentType}). Provavelmente é uma página de consulta.`,
      };
    }

    return { ok: true as const, buffer };
  } catch (error: any) {
    if (error?.name === "AbortError") {
      return { ok: false as const, message: "O portal da prefeitura demorou demais para responder." };
    }
    return { ok: false as const, message: error?.message ?? "Falha ao baixar o PDF da NFS-e." };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(_req: Request, context: { params: Promise<Params> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, message: "Não autenticado." }, { status: 401 });
    }

    const { id } = await context.params;
    const nfseId = Number(String(id ?? "").trim());
    if (!Number.isInteger(nfseId) || nfseId <= 0) {
      return NextResponse.json({ ok: false, message: "NFS-e inválida." }, { status: 400 });
    }

    const { data: nfse, error } = await supabaseAdmin
      .from("nfse")
      .select("id, ordemservicoid, numero, referencia, status, url_pdf, modelo_emissao")
      .eq("id", nfseId)
      .maybeSingle();

    if (error) throw error;
    if (!nfse) {
      return NextResponse.json({ ok: false, message: "NFS-e não encontrada." }, { status: 404 });
    }

    if (!STATUS_AUTORIZADOS.has(String(nfse.status ?? "").toUpperCase())) {
      return NextResponse.json(
        { ok: false, message: "Só é possível anexar a NFS-e depois de autorizada." },
        { status: 409 },
      );
    }

    if (!nfse.ordemservicoid) {
      return NextResponse.json(
        { ok: false, message: "Esta NFS-e não está vinculada a uma OS." },
        { status: 409 },
      );
    }

    if (!nfseEntregaPdf(nfse.modelo_emissao)) {
      return NextResponse.json(
        { ok: false, message: nfseMotivoSemPdf(nfse.modelo_emissao) },
        { status: 409 },
      );
    }

    const url = String(nfse.url_pdf ?? "").trim();
    if (!url) {
      return NextResponse.json(
        { ok: false, message: "A NFS-e ainda não tem o link do documento. Use \"Consultar NFS-e\" e tente de novo." },
        { status: 409 },
      );
    }

    const osId = Number(nfse.ordemservicoid);
    const nomeArquivo = `nfse-${String(nfse.numero || nfse.referencia || nfse.id)}.pdf`;

    const { data: existente, error: erroExistente } = await supabaseAdmin
      .from("osanexo")
      .select("id, url")
      .eq("ordemservicoid", osId)
      .eq("nome", nomeArquivo)
      .maybeSingle();

    if (erroExistente) throw erroExistente;
    if (existente) {
      return NextResponse.json(
        { ok: true, jaExistia: true, anexoId: existente.id, url: existente.url },
        { status: 200 },
      );
    }

    const { count, error: erroContagem } = await supabaseAdmin
      .from("osanexo")
      .select("id", { count: "exact", head: true })
      .eq("ordemservicoid", osId);

    if (erroContagem) throw erroContagem;
    if ((count ?? 0) >= MAX_ANEXOS_POR_OS) {
      return NextResponse.json(
        { ok: false, message: `Limite de ${MAX_ANEXOS_POR_OS} anexos por OS atingido.` },
        { status: 400 },
      );
    }

    const download = await baixarPdf(url);
    if (!download.ok) {
      return NextResponse.json({ ok: false, message: download.message }, { status: 502 });
    }

    const path = `os/${osId}/anexos/${randomUUID()}.pdf`;
    await ensureBucket();

    const { error: erroUpload } = await supabaseAdmin.storage.from(BUCKET).upload(path, download.buffer, {
      contentType: "application/pdf",
      upsert: false,
    });

    if (erroUpload) {
      return NextResponse.json(
        { ok: false, message: `Falha ao enviar a NFS-e (bucket: ${BUCKET}): ${erroUpload.message}` },
        { status: 500 },
      );
    }

    const { data: publico } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    const urlPublica = publico?.publicUrl;
    if (!urlPublica) {
      return NextResponse.json({ ok: false, message: "Falha ao gerar URL pública da NFS-e." }, { status: 500 });
    }

    const { data: salvo, error: erroInsert } = await supabaseAdmin
      .from("osanexo")
      .insert({
        ordemservicoid: osId,
        nome: nomeArquivo,
        tipo: "application/pdf",
        tamanho: download.buffer.length,
        url: urlPublica,
        path,
        descricao: `NFS-e ${nfse.numero || nfse.referencia || nfse.id}`,
        categoria: "NOTA_FISCAL",
      })
      .select("id, url")
      .single();

    if (erroInsert) {
      await supabaseAdmin.storage.from(BUCKET).remove([path]);
      return NextResponse.json({ ok: false, message: erroInsert.message }, { status: 500 });
    }

    return NextResponse.json(
      { ok: true, jaExistia: false, anexoId: salvo.id, url: salvo.url },
      { status: 201 },
    );
  } catch (error: any) {
    console.error("POST /api/nfse/[id]/anexar", error);
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Erro ao anexar a NFS-e." },
      { status: 500 },
    );
  }
}
