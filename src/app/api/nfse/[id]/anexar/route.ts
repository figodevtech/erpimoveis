export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { auth } from "@/lib/auth";
import { downloadNfsePdf } from "@/lib/nfse-pdf-download";
import { syncNfseWithFocus } from "@/lib/services/fiscais/nfse-sync";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { carregarDadosDanfse } from "@/lib/nfse/danfseDados";
import { gerarDanfsePdf } from "@/lib/nfse/danfsePdf";

type Params = { id: string };

const BUCKET = "os_anexos";
const MAX_ANEXOS_POR_OS = 10;

const STATUS_AUTORIZADOS = new Set(["AUTORIZADA", "AUTORIZADO", "EMITIDA"]);

async function ensureBucket() {
  const atual = await supabaseAdmin.storage.getBucket(BUCKET);
  if (!atual.error) return;

  const criado = await supabaseAdmin.storage.createBucket(BUCKET, { public: true });
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
    const nfseId = Number(String(id ?? "").trim());
    if (!Number.isInteger(nfseId) || nfseId <= 0) {
      return NextResponse.json({ ok: false, message: "NFS-e inválida." }, { status: 400 });
    }

    const { data: nfse, error } = await supabaseAdmin
      .from("nfse")
      // url_xml entra porque a sincronização reescreve a coluna: sem o valor
      // atual em mãos, uma consulta sem XML apagaria o que já estava gravado.
      .select("id, ordemservicoid, numero, referencia, status, url_consulta, url_pdf, url_xml, modelo_emissao, empresaid, protocolo")
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

    // Traz número, código de verificação e o endereço do PDF publicado.
    const sync = await syncNfseWithFocus(nfse);
    if (sync.ok && !STATUS_AUTORIZADOS.has(String(sync.status ?? "").toUpperCase())) {
      return NextResponse.json(
        { ok: false, message: "A NFS-e ainda não está autorizada na Focus." },
        { status: 409 },
      );
    }

    const urlPdfOficial = String((sync.ok ? sync.pdfUrl : nfse.url_pdf) ?? "").trim();
    const osId = Number(nfse.ordemservicoid);
    // Relido depois da sincronização: é nela que o número da prefeitura chega,
    // e o nome do arquivo é o que evita anexar a mesma nota duas vezes.
    const { data: atualizado } = await supabaseAdmin
      .from("nfse")
      .select("numero")
      .eq("id", nfseId)
      .maybeSingle();
    const numeroNota = atualizado?.numero || nfse.numero;
    const nomeArquivo = `nfse-${String(numeroNota || nfse.referencia || nfse.id)}.pdf`;

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

    /**
     * O documento da prefeitura é sempre a primeira escolha, e quem decide se
     * ele existe é o `url_pdf` da nota — não o município. Foi essa suposição por
     * modelo que escondia o anexo em Cabedelo, que publica DANFSe normalmente.
     *
     * O DANFSe montado aqui é a rede de segurança para os dois casos em que não
     * vem PDF: nota cujo `url_pdf` guarda o espelho de consulta (registros
     * gravados antes de a sincronização separar os dois campos) e prefeitura que
     * realmente só publica link. O download já distingue um do outro pela
     * assinatura `%PDF-`.
     */
    let arquivo: Buffer | null = null;
    let motivoDoFallback: string | null = null;

    if (urlPdfOficial) {
      const download = await downloadNfsePdf(urlPdfOficial);
      if (download.ok) {
        arquivo = download.buffer;
      } else {
        motivoDoFallback = download.message;
        console.warn("[NFS-e anexo] PDF da prefeitura indisponível, gerando DANFSe", {
          nfseId: nfse.id,
          diagnostics: download.diagnostics,
        });
      }
    } else {
      motivoDoFallback = "A prefeitura não publicou o PDF desta NFS-e.";
    }

    const documento = arquivo ? "OFICIAL" : "GERADO";
    if (!arquivo) {
      const dados = await carregarDadosDanfse(nfseId);
      if (!dados) {
        return NextResponse.json({ ok: false, message: "NFS-e não encontrada." }, { status: 404 });
      }
      arquivo = Buffer.from(await gerarDanfsePdf(dados));
    }

    const path = `os/${osId}/anexos/${randomUUID()}.pdf`;
    await ensureBucket();

    const { error: erroUpload } = await supabaseAdmin.storage.from(BUCKET).upload(path, arquivo, {
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
        tamanho: arquivo.length,
        url: urlPublica,
        path,
        descricao: documento === "OFICIAL"
          ? `NFS-e ${numeroNota || nfse.referencia || nfse.id}`
          : `DANFSe da NFS-e ${numeroNota || nfse.referencia || nfse.id}`,
        categoria: "NOTA_FISCAL",
      })
      .select("id, url")
      .single();

    if (erroInsert) {
      await supabaseAdmin.storage.from(BUCKET).remove([path]);
      return NextResponse.json({ ok: false, message: erroInsert.message }, { status: 500 });
    }

    return NextResponse.json(
      {
        ok: true,
        jaExistia: false,
        anexoId: salvo.id,
        url: salvo.url,
        // Qual documento foi parar na OS. O operador precisa saber quando levou
        // o DANFSe do sistema no lugar do papel da prefeitura.
        documento,
        motivo: motivoDoFallback,
      },
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
