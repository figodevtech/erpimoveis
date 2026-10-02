import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { atualizarRegistroNFSe, interacaoNFSe } from "@/lib/services/fiscais/nfse-registro";
import { transportDaPolitica } from "@/lib/services/fiscais/nfse-transport";
import {
  NFSeService,
  NFSeValidationError,
  conferirCodigosFiscaisNFSe,
  descricaoComplementarDoItem,
  normalizarStatusNFSe,
  validarDadosObrigatoriosNFSe,
  type NFSeCodigosFiscais,
  type NFSeItemEmissao,
} from "@/lib/services/fiscais/nfse-service";
import {
  MENSAGEM_EMISSOR_NACIONAL_EXIGIDO,
  MENSAGEM_FORA_DO_EMISSOR_NACIONAL,
  detectarMunicipioForaDoEmissorNacional,
  dataDoDiaNFSe,
  detectarEmissorMunicipalEncerrado,
  contextoEmissaoOuErro,
  itensListaDosServicos,
  type PoliticaNFSe,
} from "@/lib/services/fiscais/nfse-politica";
import { comporObservacoesComGarantia } from "@/lib/fiscal/garantiaObservacoes";
import { verificarStatusOSParaEmissao } from "@/lib/nfe/elegibilidadeEmissaoServidor";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ id: string }>;
};

type ServicoRequisitado = {
  osservicoId: number;
  valor: number;
};

type ItemServicoBanco = {
  servicoid: number;
  quantidade: number | string | null;
  precounitario: number | string | null;
  /**
   * Valor da linha já com o desconto do item. Na OS âncora quem manda é o
   * valor que a tela enviou; nas OS agregadas, que entram inteiras, é este.
   */
  subtotal?: number | string | null;
  /** Texto livre da linha da OS, que entra na discriminação abaixo do item. */
  descricao?: string | null;
  servico?: {
    descricao?: string | null;
  } | null;
};

const STATUS_ATIVOS = ["PROCESSANDO", "AUTORIZADA", "DENEGADA"];

export async function POST(req: NextRequest, { params }: RouteParams) {
  let registroId: number | null = null;
  // Guardados fora do try para que o catch tambem consiga registrar o que foi
  // montado, inclusive quando a propria chamada a Focus estoura.
  let payloadEnviado: unknown = null;
  let retornoBruto: unknown = null;

  try {
    const { id } = await params;
    const osId = Number(id);

    if (!Number.isInteger(osId) || osId <= 0) {
      return NextResponse.json({ ok: false, message: "ID da OS inválido." }, { status: 400 });
    }

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const servicosRequisitados = validarServicosRequisitados(body?.servicos);
    if (!servicosRequisitados.ok) {
      return NextResponse.json({ ok: false, message: servicosRequisitados.message }, { status: 400 });
    }

    // Na emissão agrupada, cada OS do grupo precisa estar num status liberado.
    const statusOk = await verificarStatusOSParaEmissao([
      osId,
      ...(Array.isArray(body?.osIdsAdicionais) ? body!.osIdsAdicionais : []).map(Number),
    ]);
    if (!statusOk.ok) {
      return NextResponse.json({ ok: false, message: statusOk.message }, { status: 422 });
    }

    const { data: os, error: osError } = await supabaseAdmin
      .from("ordemservico")
      .select(`
        *,
        cliente (*),
        osservico (
          *,
          servico (*)
        )
      `)
      .eq("id", osId)
      .single();

    if (osError || !os) {
      console.error("[POST /api/nfse/de-os] Erro ao buscar OS", osError);
      return NextResponse.json({ ok: false, message: "OS não encontrada ou erro no banco." }, { status: 404 });
    }

    // A OS pode existir sem cliente, mas a nota fiscal exige um tomador.
    if (!os.cliente?.id) {
      return NextResponse.json(
        { ok: false, message: "Vincule um cliente à OS antes de emitir a NFS-e." },
        { status: 400 },
      );
    }

    const itensDaOs = (Array.isArray(os.osservico) ? os.osservico : []) as ItemServicoBanco[];
    const itensSelecionados: NFSeItemEmissao[] = [];

    for (const requisitado of servicosRequisitados.servicos) {
      const item = itensDaOs.find((candidate) => Number(candidate.servicoid) === requisitado.osservicoId);
      if (!item) {
        return NextResponse.json(
          { ok: false, message: `O serviço ${requisitado.osservicoId} não pertence a esta OS.` },
          { status: 400 },
        );
      }

      itensSelecionados.push({
        servicoid: Number(item.servicoid),
        quantidade: Number(item.quantidade),
        valor: requisitado.valor,
        descricaoItem: item.descricao,
        servico: item.servico,
        ordemServicoId: osId,
      });
    }

    /*
     * Emissao agrupada: outras OS do MESMO cliente entram na mesma nota.
     *
     * Da ancora vem a selecao de servicos que a tela montou; das agregadas
     * entram todos os servicos, porque o gesto que as trouxe foi marcar a OS
     * inteira na lista de pagamentos. O tomador e unico — `nfse.clienteid` e
     * uma coluna so —, entao cliente diferente e erro de emissao, nao algo a
     * conciliar.
     */
    const osIdsAdicionais = [
      ...new Set(
        (Array.isArray(body?.osIdsAdicionais) ? body!.osIdsAdicionais : [])
          .map((valor) => Number(valor))
          .filter((valor) => Number.isInteger(valor) && valor > 0 && valor !== osId),
      ),
    ];
    const osDoGrupo: any[] = [os];

    if (osIdsAdicionais.length > 0) {
      const { data: outras, error: outrasError } = await supabaseAdmin
        .from("ordemservico")
        .select(`*, cliente (*), osservico (*, servico (*))`)
        .in("id", osIdsAdicionais);

      if (outrasError) {
        console.error("[POST /api/nfse/de-os] Erro ao buscar as OS agrupadas", outrasError);
        return NextResponse.json(
          { ok: false, message: "Nao foi possivel carregar as OS agrupadas." },
          { status: 500 },
        );
      }

      const encontradas = new Map<number, any>((outras ?? []).map((linha: any) => [Number(linha.id), linha]));
      for (const idAdicional of osIdsAdicionais) {
        const outra = encontradas.get(idAdicional);
        if (!outra) {
          return NextResponse.json(
            { ok: false, message: `A OS ${idAdicional} nao foi encontrada.` },
            { status: 404 },
          );
        }
        if (Number(outra.cliente?.id) !== Number(os.cliente.id)) {
          return NextResponse.json(
            {
              ok: false,
              message:
                `A OS ${idAdicional} pertence a outro cliente. ` +
                "Uma NFS-e tem um unico tomador — emita uma nota para cada cliente.",
            },
            { status: 400 },
          );
        }

        const servicosDaOutra = (Array.isArray(outra.osservico) ? outra.osservico : []) as ItemServicoBanco[];
        if (servicosDaOutra.length === 0) {
          return NextResponse.json(
            { ok: false, message: `A OS ${idAdicional} nao tem servicos para faturar.` },
            { status: 400 },
          );
        }

        for (const item of servicosDaOutra) {
          itensSelecionados.push({
            servicoid: Number(item.servicoid),
            quantidade: Number(item.quantidade),
            valor: Number(item.subtotal ?? 0),
            descricaoItem: item.descricao,
            servico: item.servico,
            ordemServicoId: idAdicional,
          });
        }
        osDoGrupo.push(outra);
      }
    }

    const { data: empresa, error: empresaError } = await supabaseAdmin
      .from("empresa")
      .select("*")
      .limit(1)
      .single();

    if (empresaError || !empresa) {
      return NextResponse.json({ ok: false, message: "A aplicação não possui uma empresa configurada." }, { status: 400 });
    }

    const { data: nfseConfig, error: nfseConfigError } = await supabaseAdmin
      .from("nfse_config")
      .select("token, incluir_garantia_os, padroes_emissao")
      .eq("empresa_id", empresa.id)
      .maybeSingle();
    if (nfseConfigError) throw nfseConfigError;

    const padroesEmissao = nfseConfig?.padroes_emissao
      && typeof nfseConfig.padroes_emissao === "object"
      && !Array.isArray(nfseConfig.padroes_emissao)
      ? nfseConfig.padroes_emissao as Record<string, unknown>
      : {};

    // Uma data só para a nota inteira: a mesma que escolhe o emissor vai como
    // data de competência da DPS.
    const dataCompetencia = dataDoDiaNFSe(new Date(), empresa.timezone_iana);
    // Mesma função que a tela chamou ao abrir a revisão, com a mesma seleção:
    // o modelo e o padrão daqui são os que o usuário viu.
    const resolvido = contextoEmissaoOuErro({
      empresa,
      itensListaServico: itensListaDosServicos(itensSelecionados),
      dataCompetencia,
      padroesEmissao,
    });
    if (!resolvido.ok) {
      return NextResponse.json({ ok: false, message: resolvido.message }, { status: 400 });
    }
    const { politica } = resolvido.contexto;
    const modeloEmissao = { modelo: politica.modelo };

    // O autorizador vem da política; o transporte diz se há integração. Sem
    // ela, nada é gravado nem enviado — João Pessoa no regime normal cai aqui
    // desde 01/10/2026, e mandar pelo `/v2/nfsen` dava E0039.
    const nfseService = new NFSeService();
    nfseService.configurarAmbiente(empresa.ambiente, nfseConfig?.token);
    const transport = transportDaPolitica(politica, nfseService);
    if (!transport.disponivel) {
      return NextResponse.json(
        {
          ok: false,
          codigo: "TRANSPORTE_INDISPONIVEL",
          message: transport.motivoIndisponivel,
          autorizador: transport.autorizador,
        },
        { status: 422 },
      );
    }

    const pendencias = validarDadosObrigatoriosNFSe(os, empresa, itensSelecionados, modeloEmissao.modelo);
    if (pendencias.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          message: `Preencha os dados obrigatórios antes de emitir a NFS-e: ${pendencias.join(", ")}.`,
          pendencias,
        },
        { status: 400 },
      );
    }

    const codigosRecebidos = body?.codigosFiscais && typeof body.codigosFiscais === "object"
      ? body.codigosFiscais as Record<string, unknown>
      : {};
    const informouTextoLivre = Object.prototype.hasOwnProperty.call(
      codigosRecebidos,
      "informacoes_complementares",
    );
    // Só o padrão do modelo escolhido; sem ele, nada é emprestado de outro.
    const padraoDoModelo = resolvido.contexto.padraoFiscal ?? {};
    const codigosParaValidar = informouTextoLivre
      ? codigosRecebidos
      : {
          ...codigosRecebidos,
          informacoes_complementares: comporObservacoesComGarantia({
            observacoes:
              String(os.observacoes_fiscais ?? "").trim()
              || padraoDoModelo.informacoesComplementares,
            garantia: os.garantia,
            incluir: Boolean(nfseConfig?.incluir_garantia_os),
          }),
        };

    // Como o prestador se declara na DPS é dado da empresa, não da nota: vem do
    // padrão cadastrado e não pode ser trocado pela tela de emissão.
    const validacaoFiscal = validarCodigosFiscais(
      {
        ...codigosParaValidar,
        regime_especial_tributacao: padraoDoModelo.regimeEspecialTributacao,
        regime_apuracao_simples_nacional: padraoDoModelo.regimeApuracaoSimplesNacional,
      },
      politica,
    );
    if (!validacaoFiscal.ok) {
      return NextResponse.json({ ok: false, message: validacaoFiscal.message }, { status: 400 });
    }

    const servicoIds = [...new Set(itensSelecionados.map((item) => item.servicoid))];

    /*
     * Duplicidade: nenhuma linha de servico do grupo pode estar em outra nota
     * viva. A checagem roda por OS porque o mesmo `servicoid` pode existir em
     * duas ordens diferentes, e `servico_ids` sozinho nao distingue as duas.
     *
     * Continua sendo leitura seguida de escrita, portanto sujeita a corrida —
     * a garantia de verdade e o indice unico de nfse_os_servico_vinculo, que
     * e aplicado mais abaixo, ANTES do envio a Focus. Esta checagem existe
     * para devolver uma mensagem boa no caso comum.
     */
    /*
     * A junção primeiro: ela é o único lugar que enxerga uma OS que foi
     * AGREGADA a uma nota anterior — nessa nota, `ordemservicoid` aponta para
     * a âncora, então a consulta escalar abaixo nunca a encontraria. Sem isto
     * o usuário só descobriria no índice único, depois do registro criado, com
     * uma mensagem de corrida para algo que já estava emitido.
     */
    const { data: vinculosAtivos, error: vinculosAtivosError } = await supabaseAdmin
      .from("nfse_os_servico_vinculo")
      .select("ordemservico_id, servico_id, nfse_id")
      .eq("ativo", true)
      .in("ordemservico_id", osDoGrupo.map((ordem) => Number(ordem.id)));

    if (vinculosAtivosError) {
      console.error("[POST /api/nfse/de-os] Erro ao verificar vínculos ativos", vinculosAtivosError);
      return NextResponse.json(
        {
          ok: false,
          message:
            "Não foi possível validar emissões existentes. Confirme se a migration de NFS-e foi aplicada.",
        },
        { status: 500 },
      );
    }

    const ocupados = new Set(
      (vinculosAtivos ?? []).map(
        (linha: any) => `${Number(linha.ordemservico_id)}:${Number(linha.servico_id)}`,
      ),
    );
    const jaEmitido = itensSelecionados.find((item) =>
      ocupados.has(`${Number(item.ordemServicoId ?? osId)}:${item.servicoid}`),
    );

    if (jaEmitido) {
      const ordemDoItem = Number(jaEmitido.ordemServicoId ?? osId);
      return NextResponse.json(
        {
          ok: false,
          message:
            osDoGrupo.length > 1
              ? `O serviço "${String(jaEmitido.servico?.descricao ?? jaEmitido.servicoid)}" da OS ${ordemDoItem} já está em outra NFS-e ativa.`
              : "Um dos serviços selecionados já possui uma NFS-e ativa ou em processamento.",
        },
        { status: 409 },
      );
    }

    for (const ordem of osDoGrupo) {
      const idDaOrdem = Number(ordem.id);
      const servicosDaOrdem = itensSelecionados
        .filter((item) => Number(item.ordemServicoId) === idDaOrdem)
        .map((item) => item.servicoid);
      if (servicosDaOrdem.length === 0) continue;

      const { data: notasAtivas, error: notasAtivasError } = await supabaseAdmin
        .from("nfse")
        .select("id, referencia, status")
        .eq("ordemservicoid", idDaOrdem)
        .overlaps("servico_ids", servicosDaOrdem)
        .in("status", STATUS_ATIVOS)
        .limit(1);

      if (notasAtivasError) {
        console.error("[POST /api/nfse/de-os] Erro ao verificar duplicidade", notasAtivasError);
        return NextResponse.json(
          { ok: false, message: "Não foi possível validar emissões existentes. Confirme se a migration de NFS-e foi aplicada." },
          { status: 500 },
        );
      }

      if (notasAtivas?.length) {
        return NextResponse.json(
          {
            ok: false,
            message:
              osDoGrupo.length > 1
                ? `Um servico da OS ${idDaOrdem} ja possui uma NFS-e ativa ou em processamento.`
                : "Um dos serviços selecionados já possui uma NFS-e ativa ou em processamento.",
          },
          { status: 409 },
        );
      }
    }

    // O mapeador segue o layout; o transporte, o autorizador.
    const parametrosNacionais = politica.layout === "DPS_NACIONAL"
      ? nfseService.mapearOSParaFocusNacional(os, empresa, itensSelecionados, validacaoFiscal.codigos, {
          politica,
          dataCompetencia,
        })
      : null;
    const parametrosMunicipais = politica.layout === "DPS_NACIONAL"
      ? null
      : modeloEmissao.modelo === "MUNICIPAL_CABEDELO"
        ? nfseService.mapearOSParaFocusCabedelo(os, empresa, itensSelecionados, validacaoFiscal.codigos)
        : nfseService.mapearOSParaFocus(os, empresa, itensSelecionados, validacaoFiscal.codigos);
    payloadEnviado = parametrosNacionais ?? parametrosMunicipais;
    const referencia = parametrosNacionais?.referencia ?? parametrosMunicipais?.referencia;

    if (!referencia) {
      throw new NFSeValidationError("N\u00e3o foi poss\u00edvel gerar a refer\u00eancia da NFS-e.");
    }

    const valorTotal = Math.round(itensSelecionados.reduce((total, item) => total + item.valor, 0) * 100) / 100;
    // O snapshot guarda as duas: o nome do cadastro e o texto da linha da OS,
    // que é o que a discriminação levou de fato.
    const snapshotItens = itensSelecionados.map((item) => ({
      servicoid: item.servicoid,
      // De qual OS veio esta linha. Numa nota agrupada, duas OS podem trazer o
      // mesmo serviço do catálogo: sem este campo o snapshot teria duas
      // entradas idênticas e o registro não diria a quem cada uma pertence.
      ordemservicoid: Number(item.ordemServicoId ?? osId),
      descricao: String(item.servico?.descricao ?? "").trim(),
      descricaoItem: descricaoComplementarDoItem(item.descricaoItem, item.servico?.descricao),
      quantidade: item.quantidade,
      valor: item.valor,
    }));

    const { data: registro, error: insertError } = await supabaseAdmin
      .from("nfse")
      .insert({
        ordemservicoid: os.id,
        clienteid: os.cliente.id,
        empresaid: empresa.id,
        referencia,
        status: "PROCESSANDO",
        erros: null,
        valor_total: valorTotal,
        modelo_emissao: transport.modeloEmissao,
        servico_ids: servicoIds,
        itens: snapshotItens,
        informacoes_complementares: validacaoFiscal.codigos.informacoes_complementares ?? null,
      })
      .select("id")
      .single();

    if (insertError || !registro) {
      console.error("[POST /api/nfse/de-os] Erro ao reservar registro", insertError);
      return NextResponse.json(
        { ok: false, message: "Não foi possível preparar o registro da NFS-e. A emissão não foi enviada à Focus." },
        { status: 500 },
      );
    }
    registroId = Number(registro.id);

    /*
     * O vinculo vai ANTES do envio, e essa ordem e o ponto inteiro do desenho.
     *
     * A NFS-e nao tem rascunho: o que sai daqui para a Focus e irreversivel.
     * Gravando o vinculo primeiro, uma corrida por um servico ja tomado falha
     * no indice unico enquanto nada saiu do ERP — resta apagar o registro e
     * devolver o erro. Se a ordem fosse a inversa, a nota ja estaria emitida
     * quando o conflito aparecesse.
     */
    const { error: vinculoError } = await supabaseAdmin.rpc("vincular_nfse_os", {
      p_nfse_id: registroId,
      p_itens: itensSelecionados.map((item) => ({
        ordemservico_id: Number(item.ordemServicoId ?? osId),
        servico_id: item.servicoid,
      })),
    });

    if (vinculoError) {
      await supabaseAdmin.from("nfse").delete().eq("id", registroId).eq("status", "PROCESSANDO");
      registroId = null;
      console.error("[POST /api/nfse/de-os] Erro ao vincular servicos", vinculoError);
      return NextResponse.json(
        {
          ok: false,
          message: String(vinculoError.message ?? "").includes("duplicate key")
            ? "Um dos servicos selecionados foi usado por outra NFS-e durante a emissao. Refaca a selecao."
            : vinculoError.message || "Nao foi possivel vincular os servicos a NFS-e.",
        },
        { status: 409 },
      );
    }

    const resultado = await transport.emitir(parametrosNacionais ?? parametrosMunicipais);

    // O payload que a Focus recebeu de fato: o mapeador nao conhece o
    // data_emissao, que e calculado na hora do envio.
    payloadEnviado = resultado.payload ?? payloadEnviado;
    // Guardado tambem quando autoriza: foi comparar uma autorizada com uma
    // rejeitada que isolou a variavel na investigacao da OS 195.
    retornoBruto = resultado.retornoBruto ?? retornoBruto;

    const statusFinal = resultado.ok
      ? normalizarStatusNFSe(resultado.status)
      : "REJEITADA";

    const updateError = await atualizarRegistroNFSe(
      registroId,
      {
        status: statusFinal,
        erros: resultado.ok ? null : resultado.erros,
      },
      {
        payload_enviado: payloadEnviado,
        retorno_bruto: retornoBruto,
        tentativas: [interacaoNFSe("EMISSAO", referencia, resultado.retornoBruto, payloadEnviado)].filter(Boolean),
      },
    );

    if (updateError) {
      console.error("[POST /api/nfse/de-os] Erro ao atualizar retorno Focus", updateError);
      return NextResponse.json(
        {
          ok: false,
          message: "A Focus recebeu a emissão, mas o status local não pôde ser atualizado. Consulte a referência antes de tentar novamente.",
          referencia,
        },
        { status: 500 },
      );
    }

    if (!resultado.ok) {
      // A recusa de emissor encerrado ganha explicação na frente, mas o
      // retorno da Focus segue inteiro na mensagem e em `erros`.
      const explicacao = detectarMunicipioForaDoEmissorNacional(resultado.erros)
        ? MENSAGEM_FORA_DO_EMISSOR_NACIONAL
        : detectarEmissorMunicipalEncerrado(resultado.erros)
          ? MENSAGEM_EMISSOR_NACIONAL_EXIGIDO
          : null;
      const message = explicacao ? `${explicacao} Retorno da Focus: ${resultado.message}` : resultado.message;
      return NextResponse.json(
        { ok: false, message, erros: resultado.erros, referencia },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        modeloEmissao: modeloEmissao.modelo,
        message: "NFS-e enviada para processamento.",
        referencia: resultado.referencia || referencia,
        servicoIds,
        valorTotal,
      },
      { status: 202 },
    );
  } catch (error: unknown) {
    console.error("[POST /api/nfse/de-os] Exception", error);

    if (registroId) {
      const message = error instanceof Error ? error.message : "Erro inesperado ao enviar a NFS-e.";
      await atualizarRegistroNFSe(
        registroId,
        { status: "REJEITADA", erros: [{ mensagem: message }] },
        { payload_enviado: payloadEnviado, retorno_bruto: retornoBruto },
      );
    }

    if (error instanceof NFSeValidationError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "";
    const configuracaoAusente = message.includes("Token da Focus NFe não configurado");
    return NextResponse.json(
      { ok: false, message: configuracaoAusente ? message : "Erro inesperado ao emitir NFS-e." },
      { status: configuracaoAusente ? 400 : 500 },
    );
  }
}

function validarServicosRequisitados(
  raw: unknown,
): { ok: true; servicos: ServicoRequisitado[] } | { ok: false; message: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, message: "Selecione ao menos um serviço para emitir a NFS-e." };
  }

  const ids = new Set<number>();
  const servicos: ServicoRequisitado[] = [];

  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index];
    if (!item || typeof item !== "object") {
      return { ok: false, message: `O serviço ${index + 1} é inválido.` };
    }

    const record = item as Record<string, unknown>;
    const osservicoId = Number(record.osservicoId);
    const valorBruto = Number(record.valor);
    const valor = Math.round(valorBruto * 100) / 100;

    if (!Number.isInteger(osservicoId) || osservicoId <= 0 || ids.has(osservicoId)) {
      return { ok: false, message: `O serviço ${index + 1} possui um identificador inválido ou duplicado.` };
    }
    if (!Number.isFinite(valorBruto) || valor <= 0 || valor > 9999999999999.99) {
      return { ok: false, message: `Informe um valor válido e maior que zero para o serviço ${index + 1}.` };
    }

    ids.add(osservicoId);
    servicos.push({ osservicoId, valor });
  }

  return { ok: true, servicos };
}

function validarCodigosFiscais(
  raw: unknown,
  politica: PoliticaNFSe,
): { ok: true; codigos: NFSeCodigosFiscais } | { ok: false; message: string } {
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const texto = (value: unknown) => String(value ?? "").trim();
  const digitos = (value: unknown) => texto(value).replace(/\D/g, "");
  const numeroOpcional = (value: unknown) => texto(value) === "" ? undefined : Number(value);

  const itemListaServico = texto(input.item_lista_servico);
  const codigoCnae = digitos(input.codigo_cnae);
  const codigoTributacaoNacional = digitos(input.codigo_tributacao_nacional_iss);
  const codigoTributacaoMunicipal = texto(input.codigo_tributacao_municipal_iss);
  const codigoNbs = digitos(input.codigo_nbs);
  const codigoIndicadorOperacao = digitos(input.codigo_indicador_operacao);
  const ibsCbsSituacaoTributaria = digitos(input.ibs_cbs_situacao_tributaria);
  const ibsCbsClassificacaoTributaria = digitos(input.ibs_cbs_classificacao_tributaria);
  const informacoesComplementares = texto(input.informacoes_complementares);
  const regimeEspecial = numeroOpcional(input.regime_especial_tributacao);
  const regimeApuracao = numeroOpcional(input.regime_apuracao_simples_nacional);

  if (regimeEspecial !== undefined && ![0, 1, 2, 3, 4, 5, 6, 9].includes(regimeEspecial)) {
    return { ok: false, message: "O regime especial de tributação cadastrado no padrão Nacional é inválido." };
  }
  if (regimeApuracao !== undefined && ![1, 2, 3].includes(regimeApuracao)) {
    return { ok: false, message: "O regime de apuração do Simples Nacional cadastrado no padrão Nacional é inválido." };
  }

  const codigos: NFSeCodigosFiscais = {
    item_lista_servico: itemListaServico || undefined,
    codigo_cnae: codigoCnae || undefined,
    codigo_tributacao_nacional_iss: codigoTributacaoNacional || undefined,
    codigo_tributacao_municipal_iss: codigoTributacaoMunicipal || undefined,
    codigo_nbs: codigoNbs || undefined,
    aliquota_iss: numeroOpcional(input.aliquota_iss),
    natureza_operacao: numeroOpcional(input.natureza_operacao) as NFSeCodigosFiscais["natureza_operacao"],
    iss_retido: typeof input.iss_retido === "boolean" ? input.iss_retido : undefined,
    tributacao_iss: numeroOpcional(input.tributacao_iss) as NFSeCodigosFiscais["tributacao_iss"],
    tipo_retencao_iss: numeroOpcional(input.tipo_retencao_iss) as NFSeCodigosFiscais["tipo_retencao_iss"],
    finalidade_emissao: numeroOpcional(input.finalidade_emissao) as NFSeCodigosFiscais["finalidade_emissao"],
    consumidor_final: numeroOpcional(input.consumidor_final) as NFSeCodigosFiscais["consumidor_final"],
    indicador_destinatario: numeroOpcional(input.indicador_destinatario) as NFSeCodigosFiscais["indicador_destinatario"],
    codigo_indicador_operacao: codigoIndicadorOperacao || undefined,
    ibs_cbs_situacao_tributaria: ibsCbsSituacaoTributaria || undefined,
    ibs_cbs_classificacao_tributaria: ibsCbsClassificacaoTributaria || undefined,
    informacoes_complementares: informacoesComplementares || undefined,
    regime_especial_tributacao: regimeEspecial as NFSeCodigosFiscais["regime_especial_tributacao"],
    regime_apuracao_simples_nacional: regimeApuracao as NFSeCodigosFiscais["regime_apuracao_simples_nacional"],
  };

  const pendencia = conferirCodigosFiscaisNFSe(politica, codigos);
  return pendencia ? { ok: false, message: pendencia } : { ok: true, codigos };
}
