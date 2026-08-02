export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { carregarDadosDanfe } from "@/lib/nfe/danfeData";
import { gerarDanfePdf } from "@/lib/nfe/danfePdf";

type Params = { id: string };

const MAX_ANEXOS_POR_OS = 10;
const MAX_ANEXOS_POR_VENDA = 5;

type Destino = {
  tipo: "OS" | "VENDA";
  id: number;
  tabela: "osanexo" | "vendaanexo";
  colunaVinculo: "ordemservicoid" | "vendaid";
  bucket: string;
  prefixo: string;
  limite: number;
  rotulo: string;
};

function resolverDestino(nfe: { ordemservicoid: number | null; vendaid: number | null }): Destino | null {
  if (nfe.ordemservicoid) {
    return {
      tipo: "OS", id: Number(nfe.ordemservicoid), tabela: "osanexo", colunaVinculo: "ordemservicoid",
      bucket: "os_anexos", prefixo: `os/${nfe.ordemservicoid}/anexos`, limite: MAX_ANEXOS_POR_OS, rotulo: "OS",
    };
  }
  if (nfe.vendaid) {
    return {
      tipo: "VENDA", id: Number(nfe.vendaid), tabela: "vendaanexo", colunaVinculo: "vendaid",
      bucket: "venda_anexos", prefixo: `venda/${nfe.vendaid}/anexos`, limite: MAX_ANEXOS_POR_VENDA, rotulo: "venda",
    };
  }
  return null;
}

async function ensureBucket(bucket: string) {
  const atual = await supabaseAdmin.storage.getBucket(bucket);
  if (!atual.error) return;

  const criado = await supabaseAdmin.storage.createBucket(bucket, { public: true });
  if (criado.error && !criado.error.message.toLowerCase().includes("already exists")) {
    throw criado.error;
  }
}

export async function POST(_req: Request, context: { params: Promise<Params> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, message: "Não autenticado." }, { status: 401 });
    }

    const { id } = await context.params;
    const nfeId = Number(String(id ?? "").trim());
    if (!Number.isInteger(nfeId) || nfeId <= 0) {
      return NextResponse.json({ ok: false, message: "NF-e inválida." }, { status: 400 });
    }

    const dados = await carregarDadosDanfe(nfeId);
    if (!dados) {
      return NextResponse.json({ ok: false, message: "NF-e não encontrada." }, { status: 404 });
    }

    if (!dados.view.isAutorizada) {
      return NextResponse.json(
        { ok: false, message: "Só é possível anexar o DANFE de uma NF-e autorizada." },
        { status: 409 },
      );
    }

    const destino = resolverDestino(dados.nfe);
    if (!destino) {
      return NextResponse.json(
        { ok: false, message: "Esta NF-e não está vinculada a uma OS nem a uma venda." },
        { status: 409 },
      );
    }

    const nomeArquivo = `danfe-nfe-${String(dados.view.nfe.numero).padStart(9, "0")}.pdf`;

    // Clicar duas vezes no botao nao pode gastar duas vagas do limite de anexos.
    const { data: existente, error: erroExistente } = await supabaseAdmin
      .from(destino.tabela)
      .select("id, url")
      .eq(destino.colunaVinculo, destino.id)
      .eq("nome", nomeArquivo)
      .maybeSingle();

    if (erroExistente) throw erroExistente;
    if (existente) {
      return NextResponse.json(
        { ok: true, jaExistia: true, anexoId: existente.id, url: existente.url, destino: destino.tipo },
        { status: 200 },
      );
    }

    const { count, error: erroContagem } = await supabaseAdmin
      .from(destino.tabela)
      .select("id", { count: "exact", head: true })
      .eq(destino.colunaVinculo, destino.id);

    if (erroContagem) throw erroContagem;
    if ((count ?? 0) >= destino.limite) {
      return NextResponse.json(
        { ok: false, message: `Limite de ${destino.limite} anexos por ${destino.rotulo} atingido.` },
        { status: 400 },
      );
    }

    const pdf = await gerarDanfePdf(dados.view);
    const buffer = Buffer.from(pdf);
    const path = `${destino.prefixo}/${randomUUID()}.pdf`;

    await ensureBucket(destino.bucket);

    const { error: erroUpload } = await supabaseAdmin.storage.from(destino.bucket).upload(path, buffer, {
      contentType: "application/pdf",
      upsert: false,
    });

    if (erroUpload) {
      return NextResponse.json(
        { ok: false, message: `Falha ao enviar o DANFE (bucket: ${destino.bucket}): ${erroUpload.message}` },
        { status: 500 },
      );
    }

    const { data: publico } = supabaseAdmin.storage.from(destino.bucket).getPublicUrl(path);
    const url = publico?.publicUrl;
    if (!url) {
      return NextResponse.json({ ok: false, message: "Falha ao gerar URL pública do DANFE." }, { status: 500 });
    }

    const registro = {
      [destino.colunaVinculo]: destino.id,
      nome: nomeArquivo,
      tipo: "application/pdf",
      tamanho: buffer.length,
      url,
      path,
      descricao: `DANFE da NF-e ${dados.view.nfe.numero}/série ${dados.view.nfe.serie}`,
      categoria: "NOTA_FISCAL",
    };

    const { data: salvo, error: erroInsert } = await supabaseAdmin
      .from(destino.tabela)
      .insert(registro)
      .select("id, url")
      .single();

    if (erroInsert) {
      await supabaseAdmin.storage.from(destino.bucket).remove([path]);
      return NextResponse.json({ ok: false, message: erroInsert.message }, { status: 500 });
    }

    return NextResponse.json(
      { ok: true, jaExistia: false, anexoId: salvo.id, url: salvo.url, destino: destino.tipo },
      { status: 201 },
    );
  } catch (error: any) {
    console.error("POST /api/nfe/[id]/danfe/anexar", error);
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Erro ao anexar o DANFE." },
      { status: 500 },
    );
  }
}
