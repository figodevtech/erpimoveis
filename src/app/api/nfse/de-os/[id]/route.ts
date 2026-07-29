import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { NFSeService, type NFSeCodigosFiscais } from "@/lib/services/fiscais/nfse-service";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const osId = Number(id);

    if (!Number.isFinite(osId) || osId <= 0) {
      return NextResponse.json(
        { ok: false, message: "ID da OS inválido." },
        { status: 400 }
      );
    }

    const reqBody = await req.json().catch(() => ({}));
    const { osservicoId } = reqBody;
    if (!osservicoId) {
      return NextResponse.json(
        { ok: false, message: "ID do serviço (osservicoId) não fornecido." },
        { status: 400 }
      );
    }

    // 1. Fetch OS data including services, client, and company
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
      return NextResponse.json(
        { ok: false, message: "OS não encontrada ou erro no banco." },
        { status: 404 }
      );
    }

    if (!os.osservico || os.osservico.length === 0) {
      return NextResponse.json(
        { ok: false, message: "Esta OS não possui serviços para emitir NFS-e." },
        { status: 400 }
      );
    }

    // 2. Validate and find the specific service (using the servicoid as primary key in osservico)
    const itemServico = os.osservico.find((item: any) => item.servicoid === osservicoId);
    if (!itemServico) {
      return NextResponse.json(
        { ok: false, message: "O serviço informado não pertence a esta OS ou não existe." },
        { status: 400 }
      );
    }

    const { data: empresa } = await supabaseAdmin.from("empresa").select("*").limit(1).single();
    if (!empresa) {
      return NextResponse.json(
        { ok: false, message: "A aplicação não possui uma empresa configurada." },
        { status: 400 }
      );
    }

    const { data: nfseConfig } = await supabaseAdmin
      .from("nfse_config")
      .select("token")
      .eq("empresa_id", empresa.id)
      .maybeSingle();

    const isMei = String(empresa.regimetributario) === "4";
    const codigoMunicipioEmpresa = String(empresa.codigomunicipio || "").replace(/\D/g, "");
    const isJoaoPessoa = codigoMunicipioEmpresa === "2507507";
    const isCabedelo = codigoMunicipioEmpresa === "2503209";

    if (!isMei && !isJoaoPessoa && !isCabedelo) {
      return NextResponse.json(
        { ok: false, message: `A emissão municipal ainda não está configurada para o município IBGE ${codigoMunicipioEmpresa || "não informado"}.` },
        { status: 400 },
      );
    }

    const validacaoCodigos = validarCodigosFiscais(
      reqBody.codigosFiscais,
      isMei ? "NACIONAL" : isCabedelo ? "MUNICIPAL_CABEDELO" : "MUNICIPAL_JOAO_PESSOA",
    );
    if (!validacaoCodigos.ok) {
      return NextResponse.json(
        { ok: false, message: validacaoCodigos.message },
        { status: 400 },
      );
    }

    if (!isMei && !empresa.inscricaomunicipal) {
      return NextResponse.json(
        { 
          ok: false, 
          message: "A Inscrição Municipal da empresa não está cadastrada. Por favor, complete o cadastro da empresa." 
        },
        { status: 400 }
      );
    }

    if (!os.cliente) {
      return NextResponse.json(
        { ok: false, message: "A OS não possui um cliente (tomador) vinculado." },
        { status: 400 }
      );
    }

    // 2. Validate Tomador (Client) Address mandatory fields (João Pessoa requirements)
    const clienteData = os.cliente as any;
    const requiredFields = {
      nome: clienteData.nomerazaosocial,
      logradouro: clienteData.endereco,
      numero: clienteData.endereconumero,
      bairro: clienteData.bairro,
      cep: clienteData.cep,
      uf: clienteData.estado || empresa.uf,
    };

    const missingFields = Object.entries(requiredFields)
      .filter((entry) => {
        const value = entry[1];
        return !value || value.trim() === "";
      })
      .map(([key]) => key);

    if (missingFields.length > 0) {
      return NextResponse.json(
        { 
          ok: false, 
          message: `Dados do cliente incompletos para emissão: ${missingFields.join(", ")}. Por favor, atualize o cadastro do cliente.` 
        },
        { status: 400 }
      );
    }

    // 3. Prepare parameters using Service Mapper
    const nfseService = new NFSeService();
    nfseService.configurarAmbiente(empresa.ambiente, nfseConfig?.token);
    const modeloEmissao = isMei ? "NACIONAL" : isCabedelo ? "MUNICIPAL_CABEDELO" : "MUNICIPAL_JOAO_PESSOA";
    const emitirParams = isMei
      ? nfseService.mapearOSParaFocusNacional(os, empresa, itemServico, validacaoCodigos.codigos)
      : isCabedelo
        ? nfseService.mapearOSParaFocusCabedelo(os, empresa, itemServico, validacaoCodigos.codigos)
      : nfseService.mapearOSParaFocus(os, empresa, itemServico, validacaoCodigos.codigos);

    // 4. MEI (CRT 4) usa NFS-e Nacional; demais regimes mantêm João Pessoa municipal.
    const result = isMei
      ? await nfseService.emitirNacional(emitirParams as any)
      : await nfseService.emitir(emitirParams as any);


    console.info("[POST /api/nfse/de-os] Focus retorno", {
      referencia: emitirParams.referencia,
      ok: result.ok,
      status: result.status,
    });

    // 5. Store in our Database
    const insercao = {
      ordemservicoid: os.id,
      clienteid: os.cliente.id,
      empresaid: empresa.id,
      referencia: emitirParams.referencia,
      status: result.ok
        ? ({ autorizado: "AUTORIZADA", processando_autorizacao: "PROCESSANDO", erro_autorizacao: "REJEITADA", cancelado: "CANCELADA" } as Record<string, string>)[String(result.status)] || String(result.status || "PROCESSANDO").toUpperCase()
        : "REJEITADA",
      erros: result.ok ? null : result.erros,
      valor_total: isMei ? (emitirParams as any).valor_servico : (emitirParams as any).servico.valor_servicos,
      modelo_emissao: modeloEmissao,
    };


    let { error: insertError } = await supabaseAdmin
      .from("nfse")
      .insert([insercao]);

    // Compatibilidade temporária com bases que ainda não receberam a migration
    // de modelo_emissao. A nota municipal continua consultável pelo endpoint legado.
    if (insertError?.message?.includes("modelo_emissao")) {
      const insercaoLegada: Record<string, unknown> = { ...insercao };
      delete insercaoLegada.modelo_emissao;
      const retry = await supabaseAdmin.from("nfse").insert([insercaoLegada]);
      insertError = retry.error;
    }

    if (insertError) {
      console.error("[POST /api/nfse/de-os] Erro ao gravar NFS-e no banco", insertError);
      return NextResponse.json(
        {
          ok: false,
          message: "A NFS-e foi recebida pela Focus, mas não foi possível registrá-la no sistema. Não emita novamente antes de consultar a referência.",
          referencia: result.referencia || emitirParams.referencia,
        },
        { status: 500 },
      );
    }

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, message: result.message, erros: result.erros },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { ok: true, message: "NFS-e enviada para processamento.", referencia: result.referencia || emitirParams.referencia },
      { status: 200 }
    );

  } catch (e: any) {
    console.error("[POST /api/nfse/de-os] Exception", e);
    const configuracaoAusente = String(e?.message || "").includes("Token da Focus NFe não configurado");
    return NextResponse.json(
      { ok: false, message: configuracaoAusente ? e.message : "Erro inesperado ao emitir NFS-e." },
      { status: configuracaoAusente ? 400 : 500 }
    );
  }
}

type ModeloEmissao = "NACIONAL" | "MUNICIPAL_CABEDELO" | "MUNICIPAL_JOAO_PESSOA";

function validarCodigosFiscais(
  raw: unknown,
  modelo: ModeloEmissao,
): { ok: true; codigos: NFSeCodigosFiscais } | { ok: false; message: string } {
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const texto = (value: unknown) => String(value ?? "").trim();
  const digitos = (value: unknown) => texto(value).replace(/\D/g, "");

  const itemListaServico = texto(input.item_lista_servico);
  const codigoCnae = digitos(input.codigo_cnae);
  const codigoTributarioMunicipio = texto(input.codigo_tributario_municipio);
  const codigoTributacaoNacional = digitos(input.codigo_tributacao_nacional_iss);
  const codigoNbs = texto(input.codigo_nbs);
  const codigoNbsDigitos = digitos(input.codigo_nbs);
  const aliquotaInformada = input.aliquota_iss !== "" && input.aliquota_iss !== null && input.aliquota_iss !== undefined;
  const aliquotaIss = aliquotaInformada ? Number(input.aliquota_iss) : undefined;

  if (modelo === "NACIONAL") {
    if (codigoTributacaoNacional.length !== 6) {
      return { ok: false, message: "Informe o Código de Tributação Nacional do ISS com 6 dígitos." };
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

    if (aliquotaIss === undefined || !Number.isFinite(aliquotaIss) || aliquotaIss < 0 || aliquotaIss > 100) {
      return { ok: false, message: "Informe uma alíquota de ISS válida entre 0 e 100%." };
    }
  }

  if (codigoNbs && codigoNbsDigitos.length !== 9) {
    return { ok: false, message: "Quando informado, o Código NBS deve possuir 9 dígitos." };
  }

  if (aliquotaIss !== undefined && (!Number.isFinite(aliquotaIss) || aliquotaIss < 0 || aliquotaIss > 100)) {
    return { ok: false, message: "Informe uma alíquota de ISS válida entre 0 e 100%." };
  }

  return {
    ok: true,
    codigos: {
      item_lista_servico: itemListaServico || undefined,
      codigo_cnae: codigoCnae || undefined,
      codigo_tributario_municipio: codigoTributarioMunicipio || undefined,
      codigo_tributacao_nacional_iss: codigoTributacaoNacional || undefined,
      codigo_nbs: codigoNbs || undefined,
      aliquota_iss: aliquotaIss,
    },
  };
}
