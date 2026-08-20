import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizarStatusNFSe } from "@/lib/services/fiscais/nfse-service";
import { syncNfseWithFocus } from "@/lib/services/fiscais/nfse-sync";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ id: string }>;
};

/**
 * Devolve o XML da NFS-e para leitura na tela.
 *
 * O XML aqui não é nosso: é o documento que a prefeitura emitiu, publicado pela
 * Focus. Por isso só existe para nota autorizada ou cancelada — rejeitada não
 * virou documento e não tem XML nenhum. Quem quiser ver o que foi enviado numa
 * rejeitada tem `payload_enviado` e `retorno_bruto` no registro.
 *
 * O endereço fica guardado em `url_xml`. Quando ainda não estiver lá — notas
 * autorizadas antes de a coluna passar a ser preenchida —, consulta a Focus uma
 * vez e grava, para a próxima abertura já sair direto do banco.
 */
export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const nfseId = Number(String(id ?? "").trim());

    if (!Number.isInteger(nfseId) || nfseId <= 0) {
      return NextResponse.json({ ok: false, message: "NFS-e inválida." }, { status: 400 });
    }

    const { data: nfse, error: fetchError } = await supabaseAdmin
      .from("nfse")
      // url_consulta e url_pdf entram porque a sincronização os reescreve: sem
      // eles em mãos, uma consulta apagaria o que já estava gravado.
      .select("id, referencia, status, numero, url_xml, url_consulta, url_pdf, modelo_emissao, empresaid")
      .eq("id", nfseId)
      .maybeSingle();

    if (fetchError) {
      console.error("[GET /api/nfse/xml] Erro ao buscar NFS-e", fetchError);
      return NextResponse.json({ ok: false, message: "Erro ao buscar a NFS-e." }, { status: 500 });
    }
    if (!nfse) {
      return NextResponse.json({ ok: false, message: "NFS-e não encontrada." }, { status: 404 });
    }

    const status = normalizarStatusNFSe(nfse.status);
    if (status !== "AUTORIZADA" && status !== "CANCELADA") {
      return NextResponse.json(
        {
          ok: false,
          message: "Só nota autorizada ou cancelada tem XML: é o documento que a prefeitura emitiu.",
          statusAtual: nfse.status,
        },
        { status: 400 },
      );
    }

    let urlXml: string | null = nfse.url_xml ?? null;

    if (!urlXml) {
      // Nota autorizada antes de a coluna passar a ser preenchida: a
      // sincronização consulta a Focus e grava, e a gente relê.
      try {
        await syncNfseWithFocus(nfse);
      } catch (erro) {
        console.error("[GET /api/nfse/xml] Falha ao sincronizar antes de buscar o XML", erro);
        return NextResponse.json(
          { ok: false, message: "Não foi possível consultar a Focus para localizar o XML." },
          { status: 502 },
        );
      }

      const { data: atualizado } = await supabaseAdmin
        .from("nfse")
        .select("url_xml")
        .eq("id", nfseId)
        .maybeSingle();
      urlXml = atualizado?.url_xml ?? null;

      if (!urlXml) {
        return NextResponse.json(
          { ok: false, message: "A Focus ainda não publicou o XML desta NFS-e." },
          { status: 404 },
        );
      }
    }

    const resposta = await fetch(urlXml, { cache: "no-store" });
    const xml = await resposta.text();

    if (!resposta.ok || !xml.trim().startsWith("<")) {
      console.error("[GET /api/nfse/xml] Retorno inesperado", resposta.status, xml.slice(0, 200));
      return NextResponse.json(
        { ok: false, message: "O XML não pôde ser baixado da Focus agora. Tente de novo em instantes." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      id: nfseId,
      numero: nfse.numero,
      status,
      url: urlXml,
      xml,
    });
  } catch (error: unknown) {
    console.error("[GET /api/nfse/xml] Exception", error);
    return NextResponse.json({ ok: false, message: "Erro inesperado ao carregar o XML." }, { status: 500 });
  }
}
