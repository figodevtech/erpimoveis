import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { atualizarRegistroNFSe } from "@/lib/services/fiscais/nfse-registro";
import {
  NFSeService,
  NFSeValidationError,
  identificarModeloEmissao as resolverModeloEmissao,
  normalizarStatusNFSe,
  validarDadosObrigatoriosNFSe,
  type NFSeCodigosFiscais,
  type NFSeItemEmissao,
  type NFSeModeloEmissao,
} from "@/lib/services/fiscais/nfse-service";

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
        servico: item.servico,
      });
    }

    const { data: empresa, error: empresaError } = await supabaseAdmin
      .from("empresa")
      .select("*")
      .limit(1)
      .single();

    if (empresaError || !empresa) {
      return NextResponse.json({ ok: false, message: "A aplicação não possui uma empresa configurada." }, { status: 400 });
    }

    const modeloEmissao = identificarModeloEmissao(empresa);
    if (!modeloEmissao.ok) {
      return NextResponse.json({ ok: false, message: modeloEmissao.message }, { status: 400 });
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

    const validacaoFiscal = validarCodigosFiscais(body?.codigosFiscais, modeloEmissao.modelo);
    if (!validacaoFiscal.ok) {
      return NextResponse.json({ ok: false, message: validacaoFiscal.message }, { status: 400 });
    }

    const servicoIds = itensSelecionados.map((item) => item.servicoid);
    const { data: notasAtivas, error: notasAtivasError } = await supabaseAdmin
      .from("nfse")
      .select("id, referencia, status")
      .eq("ordemservicoid", osId)
      .overlaps("servico_ids", servicoIds)
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
        { ok: false, message: "Um dos serviços selecionados já possui uma NFS-e ativa ou em processamento." },
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

    const parametrosNacionais = modeloEmissao.modelo === "NACIONAL"
      ? nfseService.mapearOSParaFocusNacional(os, empresa, itensSelecionados, validacaoFiscal.codigos)
      : null;
    const parametrosMunicipais = modeloEmissao.modelo === "NACIONAL"
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
    const snapshotItens = itensSelecionados.map((item) => ({
      servicoid: item.servicoid,
      descricao: String(item.servico?.descricao ?? "").trim(),
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
        modelo_emissao: modeloEmissao.modelo,
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

    const resultado = parametrosNacionais
      ? await nfseService.emitirNacional(parametrosNacionais)
      : await nfseService.emitir(parametrosMunicipais!);

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
      { payload_enviado: payloadEnviado, retorno_bruto: retornoBruto },
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
      return NextResponse.json(
        { ok: false, message: resultado.message, erros: resultado.erros, referencia },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
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

function identificarModeloEmissao(
  empresa: Record<string, unknown>,
): { ok: true; modelo: NFSeModeloEmissao } | { ok: false; message: string } {
  const codigoMunicipio = String(empresa.codigomunicipio ?? "").replace(/\D/g, "");
  if (codigoMunicipio.length !== 7) {
    return { ok: false, message: "Preencha o código IBGE do município da empresa com 7 dígitos antes de emitir a NFS-e." };
  }

  const modelo = resolverModeloEmissao(empresa);
  if (!modelo) {
    return {
      ok: false,
      message: `A emissão municipal ainda não está configurada para o município IBGE ${codigoMunicipio}.`,
    };
  }
  return { ok: true, modelo };
}

function validarCodigosFiscais(
  raw: unknown,
  modelo: NFSeModeloEmissao,
): { ok: true; codigos: NFSeCodigosFiscais } | { ok: false; message: string } {
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const texto = (value: unknown) => String(value ?? "").trim();
  const digitos = (value: unknown) => texto(value).replace(/\D/g, "");
  const numeroOpcional = (value: unknown) => texto(value) === "" ? undefined : Number(value);

  const itemListaServico = texto(input.item_lista_servico);
  const codigoCnae = digitos(input.codigo_cnae);
  const codigoTributacaoNacional = digitos(input.codigo_tributacao_nacional_iss);
  const codigoNbs = digitos(input.codigo_nbs);
  const aliquotaIss = numeroOpcional(input.aliquota_iss);
  const naturezaOperacao = numeroOpcional(input.natureza_operacao);
  const tributacaoIss = numeroOpcional(input.tributacao_iss);
  const tipoRetencaoIss = numeroOpcional(input.tipo_retencao_iss);
  const finalidadeEmissao = numeroOpcional(input.finalidade_emissao);
  const consumidorFinal = numeroOpcional(input.consumidor_final);
  const indicadorDestinatario = numeroOpcional(input.indicador_destinatario);
  const codigoIndicadorOperacao = digitos(input.codigo_indicador_operacao);
  const ibsCbsSituacaoTributaria = digitos(input.ibs_cbs_situacao_tributaria);
  const ibsCbsClassificacaoTributaria = digitos(input.ibs_cbs_classificacao_tributaria);
  const informacoesComplementares = texto(input.informacoes_complementares);

  if (informacoesComplementares.length > 2000) {
    return { ok: false, message: "As informações complementares devem possuir no máximo 2.000 caracteres." };
  }

  if (codigoNbs && codigoNbs.length !== 9) {
    return { ok: false, message: "Quando informado, o Código NBS deve possuir 9 dígitos." };
  }

  if (codigoIndicadorOperacao && codigoIndicadorOperacao.length !== 6) {
    return { ok: false, message: "Quando informado, o Código Indicador da Operação deve possuir 6 dígitos." };
  }

  if (aliquotaIss !== undefined && (!Number.isFinite(aliquotaIss) || aliquotaIss < 0 || aliquotaIss > 100)) {
    return { ok: false, message: "Informe uma alíquota de ISS válida entre 0 e 100%." };
  }

  if (modelo === "NACIONAL") {
    if (codigoTributacaoNacional.length !== 6) {
      return { ok: false, message: "Informe o Código de Tributação Nacional do ISS com 6 dígitos." };
    }
    if (![1, 2, 3, 4].includes(Number(tributacaoIss))) {
      return { ok: false, message: "Selecione a tributação do ISS." };
    }
    if (![1, 2, 3].includes(Number(tipoRetencaoIss))) {
      return { ok: false, message: "Selecione o tipo de retenção do ISS." };
    }
    if (finalidadeEmissao !== 0) {
      return { ok: false, message: "Selecione a finalidade da emissão da NFS-e." };
    }
    if (![0, 1].includes(Number(consumidorFinal))) {
      return { ok: false, message: "Informe se a operação é de consumo final." };
    }
    if (indicadorDestinatario !== 0) {
      return { ok: false, message: "Confirme que o destinatário é o próprio tomador." };
    }
    if (ibsCbsSituacaoTributaria.length !== 3) {
      return { ok: false, message: "Informe o CST do IBS/CBS com 3 dígitos." };
    }
    if (ibsCbsClassificacaoTributaria.length !== 6) {
      return { ok: false, message: "Informe a Classificação Tributária do IBS/CBS com 6 dígitos." };
    }
  } else {
    const itemListaDigitos = itemListaServico.replace(/\D/g, "");
    if (itemListaDigitos.length < 4 || itemListaDigitos.length > 6) {
      return { ok: false, message: "Informe um Item da Lista de Serviço válido, por exemplo 14.01." };
    }

    const tamanhoCnaeValido = modelo === "MUNICIPAL_JOAO_PESSOA"
      ? codigoCnae.length === 9
      : codigoCnae.length >= 7 && codigoCnae.length <= 9;
    if (!tamanhoCnaeValido) {
      return {
        ok: false,
        message: modelo === "MUNICIPAL_JOAO_PESSOA"
          ? "Informe a variação do CNAE com 9 dígitos exigida por João Pessoa."
          : "Informe um CNAE com 7 a 9 dígitos.",
      };
    }
    if (aliquotaIss === undefined) {
      return { ok: false, message: "Informe a alíquota do ISS." };
    }
    if (![1, 2, 3, 4, 5, 6].includes(Number(naturezaOperacao))) {
      return { ok: false, message: "Selecione a natureza da operação." };
    }
    if (typeof input.iss_retido !== "boolean") {
      return { ok: false, message: "Informe se o ISS será retido." };
    }

    if (modelo === "MUNICIPAL_CABEDELO") {
      const informouReforma = [
        input.finalidade_emissao,
        input.consumidor_final,
        input.indicador_destinatario,
        input.codigo_indicador_operacao,
        input.ibs_cbs_situacao_tributaria,
        input.ibs_cbs_classificacao_tributaria,
      ].some((value) => texto(value) !== "");

      if (informouReforma) {
        if (finalidadeEmissao !== 0 || ![0, 1].includes(Number(consumidorFinal)) || indicadorDestinatario !== 0) {
          return { ok: false, message: "Complete finalidade, consumo final e destinatário dos dados da Reforma Tributária." };
        }
        if (ibsCbsSituacaoTributaria.length !== 3 || ibsCbsClassificacaoTributaria.length !== 6) {
          return { ok: false, message: "Complete o CST e a Classificação Tributária do IBS/CBS." };
        }
      }
    }
  }

  return {
    ok: true,
    codigos: {
      item_lista_servico: itemListaServico || undefined,
      codigo_cnae: codigoCnae || undefined,
      codigo_tributacao_nacional_iss: codigoTributacaoNacional || undefined,
      codigo_nbs: codigoNbs || undefined,
      aliquota_iss: aliquotaIss,
      natureza_operacao: naturezaOperacao as NFSeCodigosFiscais["natureza_operacao"],
      iss_retido: typeof input.iss_retido === "boolean" ? input.iss_retido : undefined,
      tributacao_iss: tributacaoIss as NFSeCodigosFiscais["tributacao_iss"],
      tipo_retencao_iss: tipoRetencaoIss as NFSeCodigosFiscais["tipo_retencao_iss"],
      finalidade_emissao: finalidadeEmissao as NFSeCodigosFiscais["finalidade_emissao"],
      consumidor_final: consumidorFinal as NFSeCodigosFiscais["consumidor_final"],
      indicador_destinatario: indicadorDestinatario as NFSeCodigosFiscais["indicador_destinatario"],
      codigo_indicador_operacao: codigoIndicadorOperacao || undefined,
      ibs_cbs_situacao_tributaria: ibsCbsSituacaoTributaria || undefined,
      ibs_cbs_classificacao_tributaria: ibsCbsClassificacaoTributaria || undefined,
      informacoes_complementares: informacoesComplementares || undefined,
    },
  };
}
