import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  CODIGO_RESULTADO_INCERTO,
  MENSAGEM_ENVIO_SEM_RESPOSTA,
  acrescentarInteracaoNFSe,
  arquivarTentativaNFSe,
  atualizarRegistroNFSe,
  errosDeResultadoIncerto,
  falhaDeRedeNoEnvio,
  interacaoNFSe,
  temResultadoIncerto,
} from "@/lib/services/fiscais/nfse-registro";
import { carregarEmpresaDaNota } from "@/lib/services/fiscais/nfse-empresa";
import { descreverRecusaNFSe, desfechoDoEnvioNFSe, montarRecusaNFSe } from "@/lib/services/fiscais/nfse-recusa";
import {
  NFSeService,
  criarReferenciaPorServicos,
  normalizarStatusNFSe,
  prepararReenvioNFSe,
} from "@/lib/services/fiscais/nfse-service";
import {
  dataDoDiaNFSe,
  familiaDoModeloNFSe,
  motivoParaNaoReenviar,
  resolverPoliticaNFSe,
} from "@/lib/services/fiscais/nfse-politica";
import { transportDoRegistro } from "@/lib/services/fiscais/nfse-transport";

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
 * A nota é a MESMA: o reenvio acontece na própria linha rejeitada, e não numa
 * cópia. Rejeitada nunca virou documento na prefeitura -- fica sem número, sem
 * protocolo e sem consumir RPS --, então não há nada de fiscal preso àquele
 * registro, e trocar a referência dele basta. Antes disso a tentativa recusada
 * vai inteira para `tentativas`, que é o material de diagnóstico.
 */
export async function POST(_req: Request, { params }: RouteParams) {
  let nfseId = 0;
  /** Só depois da reserva a linha é nossa para marcar como rejeitada de novo. */
  let reservado = false;

  try {
    const { id } = await params;
    nfseId = Number(String(id ?? "").trim());

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
    // A outra que pode voltar é a de envio sem confirmação — e só com a MESMA
    // referência, porque o primeiro envio pode estar na Focus.
    const mesmaReferencia = normalizarStatusNFSe(origem.status) === "PROCESSANDO" && temResultadoIncerto(origem.erros);
    if (normalizarStatusNFSe(origem.status) !== "REJEITADA" && !mesmaReferencia) {
      return NextResponse.json(
        {
          ok: false,
          message: "Só uma NFS-e rejeitada, ou com envio sem confirmação da Focus, pode ser reenviada.",
          statusAtual: origem.status,
        },
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

    /*
     * O reenvio nunca troca o autorizador da nota: `modelo_emissao` é parte do
     * registro fiscal da tentativa, e a nota volta pelo transporte em que
     * nasceu. O que muda é quando reenviar NÃO adianta — a recusa já disse que
     * o modelo está desatualizado (L999 de emissor encerrado), a tentativa
     * histórica levou E0039, ou a política de hoje usa outro layout/endpoint.
     * Nada é enviado e a nota fica como está, com `erros`,
     * `retorno_bruto` e `tentativas` intactos.
     */
    // A empresa da nota, não a primeira do banco: é ela que emitiu e é o token
    // dela que vai no reenvio. Nota antiga sem `empresaid` só usa a empresa do
    // banco quando há uma só.
    const { data: empresa, error: empresaError } = await carregarEmpresaDaNota(
      origem.empresaid,
      "id, ambiente, codigomunicipio, regimetributario, timezone_iana",
    );
    if (empresaError || !empresa) {
      return NextResponse.json(
        { ok: false, message: empresaError?.message ?? "A empresa emitente desta NFS-e não foi encontrada." },
        { status: 409 },
      );
    }
    const empresaPolitica = empresa;
    const payload = (origem.payload_enviado ?? {}) as { servico?: { item_lista_servico?: unknown } };
    const politicaHoje = empresaPolitica
      ? resolverPoliticaNFSe({
          codigoMunicipio: empresaPolitica.codigomunicipio,
          regimeTributario: empresaPolitica.regimetributario,
          dataCompetencia: dataDoDiaNFSe(new Date(), empresaPolitica.timezone_iana),
          itensListaServico: [String(payload.servico?.item_lista_servico ?? "")],
        })
      : null;
    // E0039 bloqueia somente o reenvio exato da tentativa histórica.
    // Novas emissões seguem a política reimplementada, sem flag temporária.
    // A nota incerta é o MESMO documento: resolvê-la não depende da regra de hoje.
    const motivo = mesmaReferencia ? null : motivoParaNaoReenviar(origem, politicaHoje);
    if (motivo) {
      return NextResponse.json(
        {
          ok: false,
          codigo: "MODELO_EMISSAO_DESATUALIZADO",
          message: motivo,
          modeloDaNota: origem.modelo_emissao,
          autorizadorVigente: politicaHoje?.autorizador ?? null,
          erros: origem.erros ?? null,
        },
        { status: 409 },
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
    // viva, o reenvio duplicaria o documento. A própria linha fica de fora --
    // ela está rejeitada e não bateria com os status ativos, mas quem reenvia
    // não pode depender disso para não colidir consigo mesma.
    const { data: notasAtivas, error: notasAtivasError } = await supabaseAdmin
      .from("nfse")
      .select("id, referencia, status")
      .eq("ordemservicoid", origem.ordemservicoid)
      .neq("id", nfseId)
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

    const { data: nfseConfig } = await supabaseAdmin
      .from("nfse_config")
      .select("token")
      .eq("empresa_id", empresa.id)
      .maybeSingle();

    const nfseService = new NFSeService();
    nfseService.configurarAmbiente(empresa.ambiente, nfseConfig?.token);

    const transport = transportDoRegistro(origem.modelo_emissao, nfseService);
    if (!transport.disponivel) {
      return NextResponse.json(
        { ok: false, codigo: "TRANSPORTE_INDISPONIVEL", message: transport.motivoIndisponivel },
        { status: 409 },
      );
    }

    const referencia = mesmaReferencia
      ? String(origem.referencia)
      : criarReferenciaPorServicos(Number(origem.ordemservicoid), servicoIds);
    const historico = arquivarTentativaNFSe(origem);

    // A referência nova entra ANTES do envio: o webhook da Focus casa por ela e
    // pode chegar antes de esta requisição terminar.
    //
    // `payload_enviado` e `retorno_bruto` não são zerados aqui de propósito. Se
    // o envio estourar no meio do caminho, a linha continua com um envio
    // gravado e portanto continua reenviável; o update do desfecho, logo
    // abaixo, sobrescreve os dois com os da tentativa nova.
    const agora = new Date().toISOString();
    const reservaError = await atualizarRegistroNFSe(
      nfseId,
      {
        referencia,
        status: "PROCESSANDO",
        // A marca de incerto fica até a Focus responder: se este reenvio
        // também cair, a nota continua reconhecível como incerta.
        erros: mesmaReferencia ? origem.erros : null,
        // A Focus recalcula a data de emissão no envio: manter a da primeira
        // tentativa faria a lista da OS mentir sobre quando o RPS saiu.
        dataemissao: agora,
        updatedat: agora,
      },
      { tentativas: historico },
    );

    if (reservaError) {
      console.error("[POST /api/nfse/reemitir] Erro ao reservar a nota", reservaError);
      return NextResponse.json(
        { ok: false, message: "Não foi possível preparar o reenvio da NFS-e. Nada foi enviado à Focus." },
        { status: 500 },
      );
    }
    // Com a mesma referência, uma exceção daqui em diante nunca vira rejeição.
    reservado = !mesmaReferencia;

    const parametros = prepararReenvioNFSe(
      origem.payload_enviado as Record<string, unknown>,
      referencia,
    );

    // O payload vem do banco como JSON opaco: quem garantiu o formato foi o
    // mapeador que montou a emissão original.
    let resultado: Awaited<ReturnType<typeof transport.emitir>>;
    try {
      resultado = await transport.emitir(parametros);
    } catch (erroEnvio) {
      if (!falhaDeRedeNoEnvio(erroEnvio)) throw erroEnvio;
      // Sem resposta, a Focus pode ter recebido esta referência: a nota não
      // volta a REJEITADA, senão um novo reenvio duplicaria o documento.
      console.error("[POST /api/nfse/reemitir] Envio sem resposta", erroEnvio);
      reservado = false;
      await atualizarRegistroNFSe(
        nfseId,
        {
          status: "PROCESSANDO",
          erros: errosDeResultadoIncerto(erroEnvio instanceof Error ? erroEnvio.message : ""),
          updatedat: new Date().toISOString(),
        },
        { payload_enviado: parametros },
      );
      return NextResponse.json(
        { ok: false, codigo: CODIGO_RESULTADO_INCERTO, message: MENSAGEM_ENVIO_SEM_RESPOSTA, referencia },
        { status: 502 },
      );
    }

    /*
     * Desfecho da resposta:
     * - aceito, ou a Focus já tinha a referência: segue em processamento, e a
     *   consulta traz o resultado;
     * - 5xx: continua incerto, com a mesma referência;
     * - recusa 4xx explícita: rejeitada. Na mesma referência isso só vale no
     *   `/v2/nfsen`, onde a Focus documenta a recusa de referência repetida:
     *   o mesmo payload recusado agora teria sido recusado na primeira vez. No
     *   municipal essa recusa não é documentada, e a nota continua incerta.
     */
    let desfecho = desfechoDoEnvioNFSe(resultado);
    if (mesmaReferencia && desfecho === "REJEITADO" && familiaDoModeloNFSe(origem.modelo_emissao) !== "NACIONAL") {
      desfecho = "INCERTO";
    }
    const statusFinal = desfecho === "ACEITO"
      ? normalizarStatusNFSe(resultado.status)
      : desfecho === "REJEITADO" ? "REJEITADA" : "PROCESSANDO";
    const errosFinais = desfecho === "ACEITO" || desfecho === "JA_RECEBIDO"
      ? null
      : desfecho === "INCERTO"
        ? errosDeResultadoIncerto(`HTTP ${resultado.retornoBruto?.http_status ?? "?"}: ${resultado.message ?? ""}`)
        : resultado.erros;

    const updateError = await atualizarRegistroNFSe(
      nfseId,
      {
        status: statusFinal,
        erros: errosFinais,
        updatedat: new Date().toISOString(),
      },
      {
        payload_enviado: resultado.payload,
        retorno_bruto: resultado.retornoBruto,
        tentativas: acrescentarInteracaoNFSe(
          historico,
          interacaoNFSe("REENVIO", referencia, resultado.retornoBruto, resultado.payload),
        ),
      },
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

    if (desfecho === "INCERTO") {
      return NextResponse.json(
        {
          ok: false,
          codigo: CODIGO_RESULTADO_INCERTO,
          message: MENSAGEM_ENVIO_SEM_RESPOSTA,
          httpStatus: resultado.retornoBruto?.http_status ?? null,
          erros: resultado.erros,
          referencia,
        },
        { status: 502 },
      );
    }

    if (desfecho === "REJEITADO") {
      const rejeicao = montarRecusaNFSe({
        envio: resultado,
        referencia,
        ambiente: empresa.ambiente,
        codigoMunicipio: empresa.codigomunicipio,
      });
      return NextResponse.json(
        { ok: false, message: descreverRecusaNFSe(rejeicao), rejeicao, erros: resultado.erros, referencia },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        message: desfecho === "JA_RECEBIDO"
          ? "A Focus já tinha recebido esta referência: a nota segue em processamento e a consulta traz o desfecho."
          : "NFS-e reenviada para processamento.",
        referencia,
        nfseId,
      },
      { status: 202 },
    );
  } catch (error: unknown) {
    console.error("[POST /api/nfse/reemitir] Exception", error);

    // A nota ficou em PROCESSANDO esperando um envio que estourou: devolvê-la
    // para rejeitada é o que reabre o botão de reenvio.
    if (reservado) {
      const message = error instanceof Error ? error.message : "Erro inesperado ao reenviar a NFS-e.";
      await atualizarRegistroNFSe(nfseId, {
        status: "REJEITADA",
        erros: [{ mensagem: message }],
        updatedat: new Date().toISOString(),
      });
    }

    return NextResponse.json({ ok: false, message: "Erro inesperado ao reenviar a NFS-e." }, { status: 500 });
  }
}
