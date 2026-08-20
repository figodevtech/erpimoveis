import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { atualizarRegistroNFSe } from "@/lib/services/fiscais/nfse-registro";
import {
  NFSeService,
  criarReferenciaPorServicos,
  normalizarStatusNFSe,
  prepararReenvioNFSe,
  type NFSeEmitirParams,
  type NFSeNacionalEmitirParams,
} from "@/lib/services/fiscais/nfse-service";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const STATUS_ATIVOS = ["PROCESSANDO", "AUTORIZADA", "DENEGADA"];

/**
 * Reenvia uma NFS-e rejeitada sem remontar nada.
 *
 * O que vai para a Focus é o mesmo `payload_enviado` da tentativa anterior,
 * byte a byte, com duas exceções obrigatórias: a referência, que a Focus não
 * deixa reaproveitar nem depois de rejeitar, e a data de emissão, que o serviço
 * recalcula no envio -- um RPS com data de ontem é recusado pela prefeitura.
 *
 * Existe para a rejeição que não é culpa do conteúdo: prefeitura fora do ar,
 * falha de commit do lado deles, indisponibilidade momentânea. Quando o
 * problema é de dados, reenviar igual só repete a recusa -- corrija pelo
 * diálogo de emissão.
 *
 * Cada tentativa nasce como um registro novo. A rejeitada fica onde está, com
 * o payload e o retorno bruto dela, que é o material de diagnóstico; para
 * descartá-la existe o DELETE.
 */
export async function POST(_req: Request, { params }: RouteParams) {
  let novoRegistroId: number | null = null;

  try {
    const { id } = await params;
    const nfseId = Number(String(id ?? "").trim());

    if (!Number.isInteger(nfseId) || nfseId <= 0) {
      return NextResponse.json({ ok: false, message: "NFS-e inválida." }, { status: 400 });
    }

    const { data: origem, error: origemError } = await supabaseAdmin
      .from("nfse")
      .select("*")
      .eq("id", nfseId)
      .maybeSingle();

    if (origemError) {
      console.error("[POST /api/nfse/reemitir] Erro ao buscar NFS-e", origemError);
      return NextResponse.json({ ok: false, message: "Erro ao buscar a NFS-e." }, { status: 500 });
    }
    if (!origem) {
      return NextResponse.json({ ok: false, message: "NFS-e não encontrada." }, { status: 404 });
    }

    // Pela normalização, não pelo texto cru: notas gravadas antes dela ficaram
    // com o `erro_autorizacao` da Focus, que é a mesma coisa que REJEITADA.
    if (normalizarStatusNFSe(origem.status) !== "REJEITADA") {
      return NextResponse.json(
        { ok: false, message: "Só uma NFS-e rejeitada pode ser reenviada.", statusAtual: origem.status },
        { status: 400 },
      );
    }

    if (!origem.payload_enviado) {
      return NextResponse.json(
        {
          ok: false,
          message: "Esta NFS-e é anterior ao registro do envio, então não há o que reenviar. Emita pelo diálogo de emissão.",
        },
        { status: 400 },
      );
    }

    const servicoIds = Array.isArray(origem.servico_ids) ? origem.servico_ids.map(Number) : [];
    if (servicoIds.length === 0) {
      return NextResponse.json(
        { ok: false, message: "A NFS-e rejeitada não guarda quais serviços foram enviados. Emita pelo diálogo de emissão." },
        { status: 400 },
      );
    }

    // Mesma trava da emissão normal: se algum serviço já entrou em outra nota
    // viva, o reenvio duplicaria o documento.
    const { data: notasAtivas, error: notasAtivasError } = await supabaseAdmin
      .from("nfse")
      .select("id, referencia, status")
      .eq("ordemservicoid", origem.ordemservicoid)
      .overlaps("servico_ids", servicoIds)
      .in("status", STATUS_ATIVOS)
      .limit(1);

    if (notasAtivasError) {
      console.error("[POST /api/nfse/reemitir] Erro ao verificar duplicidade", notasAtivasError);
      return NextResponse.json({ ok: false, message: "Não foi possível validar emissões existentes." }, { status: 500 });
    }
    if (notasAtivas?.length) {
      return NextResponse.json(
        { ok: false, message: "Um dos serviços desta nota já possui uma NFS-e ativa ou em processamento." },
        { status: 409 },
      );
    }

    const { data: empresa, error: empresaError } = await supabaseAdmin
      .from("empresa")
      .select("id, ambiente")
      .limit(1)
      .single();

    if (empresaError || !empresa) {
      return NextResponse.json({ ok: false, message: "A aplicação não possui uma empresa configurada." }, { status: 400 });
    }

    const { data: nfseConfig } = await supabaseAdmin
      .from("nfse_config")
      .select("token")
      .eq("empresa_id", empresa.id)
      .maybeSingle();

    const nfseService = new NFSeService();
    nfseService.configurarAmbiente(empresa.ambiente, nfseConfig?.token);

    const referencia = criarReferenciaPorServicos(Number(origem.ordemservicoid), servicoIds);
    const ehNacional = origem.modelo_emissao === "NACIONAL";

    const { data: registro, error: insertError } = await supabaseAdmin
      .from("nfse")
      .insert({
        ordemservicoid: origem.ordemservicoid,
        clienteid: origem.clienteid,
        empresaid: origem.empresaid,
        referencia,
        status: "PROCESSANDO",
        erros: null,
        valor_total: origem.valor_total,
        modelo_emissao: origem.modelo_emissao,
        servico_ids: servicoIds,
        itens: origem.itens,
        informacoes_complementares: origem.informacoes_complementares,
      })
      .select("id")
      .single();

    if (insertError || !registro) {
      console.error("[POST /api/nfse/reemitir] Erro ao reservar registro", insertError);
      return NextResponse.json(
        { ok: false, message: "Não foi possível preparar o registro da NFS-e. Nada foi enviado à Focus." },
        { status: 500 },
      );
    }
    novoRegistroId = Number(registro.id);

    const parametros = prepararReenvioNFSe(
      origem.payload_enviado as Record<string, unknown>,
      referencia,
    );

    // O payload vem do banco como JSON opaco: quem garantiu o formato foi o
    // mapeador que montou a emissão original.
    const resultado = ehNacional
      ? await nfseService.emitirNacional(parametros as unknown as NFSeNacionalEmitirParams)
      : await nfseService.emitir(parametros as unknown as NFSeEmitirParams);

    const statusFinal = resultado.ok ? normalizarStatusNFSe(resultado.status) : "REJEITADA";

    const updateError = await atualizarRegistroNFSe(
      novoRegistroId,
      { status: statusFinal, erros: resultado.ok ? null : resultado.erros },
      { payload_enviado: resultado.payload, retorno_bruto: resultado.retornoBruto },
    );

    if (updateError) {
      console.error("[POST /api/nfse/reemitir] Erro ao atualizar retorno Focus", updateError);
      return NextResponse.json(
        {
          ok: false,
          message: "A Focus recebeu o reenvio, mas o status local não pôde ser atualizado. Consulte a referência antes de tentar de novo.",
          referencia,
        },
        { status: 500 },
      );
    }

    if (!resultado.ok) {
      return NextResponse.json(
        { ok: false, message: resultado.message, erros: resultado.erros, referencia },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { ok: true, message: "NFS-e reenviada para processamento.", referencia, nfseId: novoRegistroId },
      { status: 202 },
    );
  } catch (error: unknown) {
    console.error("[POST /api/nfse/reemitir] Exception", error);

    if (novoRegistroId) {
      const message = error instanceof Error ? error.message : "Erro inesperado ao reenviar a NFS-e.";
      await atualizarRegistroNFSe(novoRegistroId, { status: "REJEITADA", erros: [{ mensagem: message }] });
    }

    return NextResponse.json({ ok: false, message: "Erro inesperado ao reenviar a NFS-e." }, { status: 500 });
  }
}
