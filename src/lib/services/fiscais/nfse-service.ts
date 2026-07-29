export type NFSeEmitirParams = {
  referencia: string;
  natureza_operacao?: number | string;
  optante_simples_nacional?: boolean;
  regime_tributario_simples_nacional?: 1 | 2 | 3;
  regime_especial_tributacao?: number | string;
  prestador: {
    cnpj: string;
    inscricao_municipal: string;
    codigo_municipio: string;
  };
  tomador: {
    cpf?: string;
    cnpj?: string;
    razao_social: string;
    email?: string;
    telefone?: string;
    endereco?: {
      logradouro?: string;
      numero?: string;
      complemento?: string;
      bairro?: string;
      codigo_municipio?: string;
      uf?: string;
      cep?: string;
    };
  };
  servico: {
    aliquota: number;
    discriminacao: string;
    iss_retido: boolean | string;
    item_lista_servico: string;
    codigo_tributario_municipio?: string;
    codigo_cnae?: string;
    codigo_nbs?: string;
    valor_servicos: number;
  };
};

export type NFSeCodigosFiscais = {
  item_lista_servico?: string;
  codigo_cnae?: string;
  codigo_tributario_municipio?: string;
  codigo_tributacao_nacional_iss?: string;
  codigo_nbs?: string;
  aliquota_iss?: number;
};

export type NFSeNacionalEmitirParams = {
  referencia: string;
  data_competencia: string;
  codigo_municipio_emissora: number;
  cnpj_prestador: string;
  inscricao_municipal_prestador?: string;
  codigo_opcao_simples_nacional: 2;
  regime_especial_tributacao: 0;
  cpf_tomador?: string;
  cnpj_tomador?: string;
  razao_social_tomador: string;
  codigo_municipio_tomador?: number;
  cep_tomador?: string;
  logradouro_tomador?: string;
  numero_tomador?: string;
  complemento_tomador?: string;
  bairro_tomador?: string;
  email_tomador?: string;
  codigo_municipio_prestacao: string;
  codigo_tributacao_nacional_iss: string;
  codigo_tributacao_municipal_iss?: string;
  codigo_nbs?: string;
  descricao_servico: string;
  valor_servico: number;
  tributacao_iss: 1;
  tipo_retencao_iss: 1;
  percentual_aliquota_relativa_municipio?: number;
  indicador_total_tributacao: "0";
};

export class NFSeService {
  private apiUrl: string;
  private token: string;
  private ambiente: "PRODUCAO" | "HOMOLOGACAO" = "HOMOLOGACAO";

  constructor() {
    this.token = "";
    this.apiUrl = "";
  }

  /**
   * Configura o ambiente (Homologação ou Produção) baseado na coluna ambiente da tabela empresa.
   * Chamado antes de qualquer emissão ou consulta.
   */
  configurarAmbiente(ambiente: "PRODUCAO" | "HOMOLOGACAO" | string, tokenConfigurado?: string | null) {
    this.ambiente = ambiente === "PRODUCAO" ? "PRODUCAO" : "HOMOLOGACAO";
    if (ambiente === "PRODUCAO") {
      this.token = process.env.FOCUS_NFE_API_TOKEN || tokenConfigurado?.trim() || "";
      this.apiUrl = "https://api.focusnfe.com.br";
    } else {
      this.token = process.env.FOCUS_NFE_API_TOKEN_HOMOLOGACAO || tokenConfigurado?.trim() || "";
      this.apiUrl = "https://homologacao.focusnfe.com.br";
    }

    // Sobrescrita manual via env (se existir ainda para fins de debug local)
    if (process.env.FOCUS_NFE_API_URL) {
      this.apiUrl = process.env.FOCUS_NFE_API_URL;
    }
  }

  private getAuthHeader() {
    return `Basic ${Buffer.from(this.token + ":").toString("base64")}`;
  }

  private assertToken() {
    if (!this.token) {
      const variavel = this.ambiente === "PRODUCAO" ? "FOCUS_NFE_API_TOKEN" : "FOCUS_NFE_API_TOKEN_HOMOLOGACAO";
      throw new Error(`Token da Focus NFe não configurado para ${this.ambiente}. Cadastre o token da NFS-e nas configurações fiscais ou defina ${variavel}.`);
    }
  }

  async emitir(params: NFSeEmitirParams) {
    this.assertToken();

    const url = `${this.apiUrl}/v2/nfse?ref=${params.referencia}`;

    // Ajuste manual de Timezone para fuso Brasília (UTC-3)
    // Isso evita que, à noite, o envio seja visto como "dia seguinte" pela prefeitura em UTC.
    const dataEmissao = formatDateTimeForFocus(new Date(Date.now() - 5 * 60 * 1000));

    const payload: any = {
      data_emissao: dataEmissao,
      prestador: params.prestador,
      tomador: params.tomador,
      servico: params.servico,
    };

    if (params.natureza_operacao !== undefined) payload.natureza_operacao = params.natureza_operacao;
    if (params.optante_simples_nacional !== undefined) payload.optante_simples_nacional = params.optante_simples_nacional;
    if (params.regime_tributario_simples_nacional !== undefined) {
      payload.regime_tributario_simples_nacional = params.regime_tributario_simples_nacional;
    }
    if (params.regime_especial_tributacao !== undefined) payload.regime_especial_tributacao = params.regime_especial_tributacao;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getAuthHeader(),
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      let msg = json?.mensagem || json?.codigo || `Erro ${res.status} ao emitir NFS-e`;
      const errosArr = json?.erros || (json ? [json] : []);
      
      if (errosArr.length > 0) {
        const errorDetails = errosArr.map((e: any) => e.mensagem || e.codigo || JSON.stringify(e)).join(" | ");
        msg = errorDetails.includes(msg) ? errorDetails : `${msg}: ${errorDetails}`;
      }

      return {
        ok: false,
        message: msg,
        erros: errosArr,
      };
    }

    return {
      ok: true,
      status: json?.status || "processando_autorizacao",
      referencia: json?.ref,
    };
  }

  async emitirNacional(params: NFSeNacionalEmitirParams) {
    this.assertToken();
    const { referencia, ...dados } = params;
    const payload = { data_emissao: `${formatDateTimeForFocus(new Date())}-03:00`, ...dados };
    const res = await fetch(`${this.apiUrl}/v2/nfsen?ref=${encodeURIComponent(referencia)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: this.getAuthHeader() },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const erros = json?.erros || (json ? [json] : []);
      return { ok: false, message: json?.mensagem || json?.codigo || `Erro ${res.status} ao emitir NFS-e Nacional`, erros };
    }
    return { ok: true, status: json?.status || "processando_autorizacao", referencia: json?.ref || referencia };
  }

  async consultar(referencia: string, modelo: "MUNICIPAL" | "NACIONAL" = "MUNICIPAL") {
    this.assertToken();

    const url = `${this.apiUrl}/v2/${modelo === "NACIONAL" ? "nfsen" : "nfse"}/${referencia}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: this.getAuthHeader(),
      },
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      return {
        ok: false,
        message: json?.mensagem || "Erro ao consultar NFS-e",
        erros: json?.erros || [json],
      };
    }

    return {
      ok: true,
      status: json?.status,
      numero: json?.numero,
      codigo_verificacao: json?.codigo_verificacao,
      url: json?.url || json?.url_pdf || json?.url_danfse || json?.caminho_danfse,
      caminho_xml_nota_fiscal: json?.caminho_xml_nota_fiscal,
      erros: json?.erros,
    };
  }

  async cancelar(referencia: string, justificativa?: string, modelo: "MUNICIPAL" | "NACIONAL" = "MUNICIPAL") {
    this.assertToken();

    const url = `${this.apiUrl}/v2/${modelo === "NACIONAL" ? "nfsen" : "nfse"}/${referencia}`;

    const options: RequestInit = {
      method: "DELETE",
      headers: {
        Authorization: this.getAuthHeader(),
      },
    };

    if (justificativa) {
      options.headers = {
        ...options.headers,
        "Content-Type": "application/json",
      };
      options.body = JSON.stringify({ justificativa });
    }

    const res = await fetch(url, options);

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      return {
        ok: false,
        message: json?.mensagem || "Erro ao cancelar NFS-e",
        erros: json?.erros || [json],
      };
    }

    return {
      ok: true,
      status: json?.status,
    };
  }

  async configurarEmpresa(empresa: any, certificadoBase64?: string, senhaCertificado?: string) {
    this.assertToken();

    const cnpj = empresa.cnpj?.replace(/\D/g, "");
    if (!cnpj) throw new Error("CNPJ é obrigatório para configurar empresa.");

    const payload: any = {
      cnpj: cnpj,
      inscricao_municipal: empresa.inscricaomunicipal?.replace(/\D/g, "") || "",
      inscricao_estadual: empresa.inscricaoestadual?.replace(/\D/g, "") || "",
      nome_fantasia: empresa.nomefantasia || empresa.razaosocial,
      razao_social: empresa.razaosocial,
      email: empresa.email || "",
      telefone: empresa.telefone?.replace(/\D/g, "") || "",
      logradouro: empresa.endereco || "Não Informado",
      numero: empresa.numero || "S/N",
      complemento: empresa.complemento || "",
      bairro: empresa.bairro || "Centro",
      codigo_municipio: empresa.codigomunicipio || "",
      uf: empresa.uf || "",
      cep: empresa.cep?.replace(/\D/g, "") || "",
      regime_tributario: empresa.regimetributario || 3, // Padrão: 3 (Regime Normal)
      enviar_email_destinatario: false,
    };

    if (certificadoBase64 && senhaCertificado) {
      payload.certificado_arquivo = certificadoBase64;
      payload.certificado_senha = senhaCertificado;
    }

    // Try POST first
    let res = await fetch(`${this.apiUrl}/v2/empresas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getAuthHeader(),
      },
      body: JSON.stringify(payload),
    });

    let json = await res.json().catch(() => null);

    // If it already exists, use PUT
    if (!res.ok && (json?.codigo === "cnpj_ja_cadastrado" || res.status === 400 || res.status === 422)) {
      res = await fetch(`${this.apiUrl}/v2/empresas/${cnpj}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.getAuthHeader(),
        },
        body: JSON.stringify(payload),
      });
      json = await res.json().catch(() => null);
    }

    if (!res.ok) {
      return {
        ok: false,
        message: json?.mensagem || "Erro ao configurar empresa na FocusNFe",
        erros: json?.erros || [json],
      };
    }

    return {
      ok: true,
      message: "Empresa configurada com sucesso",
      dados: json
    };
  }

  /**
   * Mapeia os dados do sistema para o formato esperado pela Focus NFe.
   * Centraliza as regras de negócio de João Pessoa e sanitização.
   */
  mapearOSParaFocus(
    os: any,
    empresa: any,
    itemServico: any,
    codigosFiscais: NFSeCodigosFiscais,
  ): NFSeEmitirParams {
    const cliente = os.cliente;
    const servico = itemServico.servico;

    const q = itemServico.quantidade || 1;
    const v = itemServico.precounitario || 0;
    const val = q * v;

    const referencia = `OS_${os.id}_SRV_${itemServico.servicoid}_${Date.now()}`;

    return {

      referencia,
      natureza_operacao: 1, // Tributação no município
      optante_simples_nacional: empresa.regimetributario === "1",
      regime_especial_tributacao: empresa.regimetributario === "1" ? 6 : undefined, // 6 Microempresa Municipal (JP)
      prestador: {
        cnpj: empresa.cnpj?.replace(/\D/g, "") || "",
        inscricao_municipal: empresa.inscricaomunicipal?.replace(/\D/g, "") || "",
        codigo_municipio: empresa.codigomunicipio || "2507507", // João Pessoa fallback
      },
      tomador: {
        cpf: cliente.cpfcnpj?.replace(/\D/g, "").length <= 11 ? cliente.cpfcnpj.replace(/\D/g, "") : undefined,
        cnpj: cliente.cpfcnpj?.replace(/\D/g, "").length > 11 ? cliente.cpfcnpj.replace(/\D/g, "") : undefined,
        razao_social: cliente.nomerazaosocial || "Consumidor Final",
        email: cliente.email || undefined,
        endereco: {
          logradouro: (cliente.endereco || "Não Informado").substring(0, 100),
          numero: cliente.endereconumero || "S/N",
          complemento: (cliente.enderecocomplemento || "").substring(0, 100) || undefined,
          bairro: (cliente.bairro || "Centro").substring(0, 60),
          codigo_municipio: cliente.codigomunicipio || empresa.codigomunicipio || "2507507",
          uf: cliente.estado || empresa.uf || "PB",
          cep: cliente.cep?.replace(/\D/g, "").substring(0, 8) || "58000000",
        },
      },
      servico: {
        aliquota: Number(codigosFiscais.aliquota_iss),
        discriminacao: `${q}x ${servico?.descricao || "Serviço"} - OS #${os.id}`,
        iss_retido: false,
        item_lista_servico: String(codigosFiscais.item_lista_servico || "").trim(),
        codigo_tributario_municipio: codigosFiscais.codigo_tributario_municipio || undefined,
        codigo_cnae: String(codigosFiscais.codigo_cnae || "").replace(/\D/g, ""),
        codigo_nbs: codigosFiscais.codigo_nbs || undefined,
        valor_servicos: val,
      },
    };
  }

  mapearOSParaFocusCabedelo(
    os: any,
    empresa: any,
    itemServico: any,
    codigosFiscais: NFSeCodigosFiscais,
  ): NFSeEmitirParams {
    const cliente = os.cliente;
    const servico = itemServico.servico;
    const documento = String(cliente.cpfcnpj || "").replace(/\D/g, "");
    const quantidade = Number(itemServico.quantidade || 1);
    const valor = quantidade * Number(itemServico.precounitario || 0);
    const cnae = String(codigosFiscais.codigo_cnae || "").replace(/\D/g, "");
    const itemLista = String(codigosFiscais.item_lista_servico || "").trim();

    if (!cnae) throw new Error("Informe o CNAE do serviço ou da empresa para emitir NFS-e em Cabedelo.");
    if (!itemLista) throw new Error("Informe o item da lista de serviço para emitir NFS-e em Cabedelo.");

    return {
      referencia: `OS_${os.id}_SRV_${itemServico.servicoid}_${Date.now()}`,
      natureza_operacao: 1,
      optante_simples_nacional: String(empresa.regimetributario) === "1",
      regime_tributario_simples_nacional: String(empresa.regimetributario) === "1" ? 1 : undefined,
      regime_especial_tributacao: String(empresa.regimetributario) === "1" ? 6 : undefined,
      prestador: {
        cnpj: String(empresa.cnpj || "").replace(/\D/g, ""),
        inscricao_municipal: String(empresa.inscricaomunicipal || "").replace(/\D/g, ""),
        codigo_municipio: "2503209",
      },
      tomador: {
        cpf: documento.length <= 11 ? documento : undefined,
        cnpj: documento.length > 11 ? documento : undefined,
        razao_social: cliente.nomerazaosocial || "Consumidor Final",
        email: cliente.email || undefined,
        telefone: String(cliente.telefone || "").replace(/\D/g, "") || undefined,
        endereco: {
          logradouro: String(cliente.endereco || "").substring(0, 100),
          numero: cliente.endereconumero || "S/N",
          complemento: String(cliente.enderecocomplemento || "").substring(0, 100) || undefined,
          bairro: String(cliente.bairro || "").substring(0, 60),
          codigo_municipio: cliente.codigomunicipio || "2503209",
          uf: cliente.estado || "PB",
          cep: String(cliente.cep || "").replace(/\D/g, "").substring(0, 8),
        },
      },
      servico: {
        aliquota: Number(codigosFiscais.aliquota_iss),
        discriminacao: `${quantidade}x ${servico?.descricao || "Serviço"} - OS #${os.id}`,
        iss_retido: false,
        item_lista_servico: itemLista,
        codigo_tributario_municipio: codigosFiscais.codigo_tributario_municipio || undefined,
        codigo_cnae: cnae,
        codigo_nbs: codigosFiscais.codigo_nbs || undefined,
        valor_servicos: valor,
      },
    };
  }

  mapearOSParaFocusNacional(
    os: any,
    empresa: any,
    itemServico: any,
    codigosFiscais: NFSeCodigosFiscais,
  ): NFSeNacionalEmitirParams {
    const cliente = os.cliente;
    const servico = itemServico.servico;
    const documento = String(cliente.cpfcnpj || "").replace(/\D/g, "");
    const quantidade = Number(itemServico.quantidade || 1);
    const valor = quantidade * Number(itemServico.precounitario || 0);
    const hoje = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
    return {
      referencia: `OS_${os.id}_SRV_${itemServico.servicoid}_${Date.now()}`,
      data_competencia: hoje,
      codigo_municipio_emissora: Number(empresa.codigomunicipio || 2507507),
      cnpj_prestador: String(empresa.cnpj || "").replace(/\D/g, ""),
      inscricao_municipal_prestador: String(empresa.inscricaomunicipal || "").replace(/\D/g, "") || undefined,
      codigo_opcao_simples_nacional: 2,
      regime_especial_tributacao: 0,
      cpf_tomador: documento.length <= 11 ? documento : undefined,
      cnpj_tomador: documento.length > 11 ? documento : undefined,
      razao_social_tomador: cliente.nomerazaosocial || "Consumidor Final",
      codigo_municipio_tomador: Number(cliente.codigomunicipio || empresa.codigomunicipio || 2507507),
      cep_tomador: String(cliente.cep || "").replace(/\D/g, "") || undefined,
      logradouro_tomador: cliente.endereco || undefined,
      numero_tomador: cliente.endereconumero || undefined,
      complemento_tomador: cliente.enderecocomplemento || undefined,
      bairro_tomador: cliente.bairro || undefined,
      email_tomador: cliente.email || undefined,
      codigo_municipio_prestacao: String(empresa.codigomunicipio || 2507507),
      codigo_tributacao_nacional_iss: String(codigosFiscais.codigo_tributacao_nacional_iss || "").replace(/\D/g, ""),
      codigo_tributacao_municipal_iss: codigosFiscais.codigo_tributario_municipio || undefined,
      codigo_nbs: codigosFiscais.codigo_nbs
        ? String(codigosFiscais.codigo_nbs).replace(/\D/g, "")
        : undefined,
      descricao_servico: `${quantidade}x ${servico?.descricao || "Serviço"} - OS #${os.id}`,
      valor_servico: valor,
      tributacao_iss: 1,
      tipo_retencao_iss: 1,
      percentual_aliquota_relativa_municipio: codigosFiscais.aliquota_iss,
      indicador_total_tributacao: "0",
    };
  }
}

function formatDateTimeForFocus(date: Date) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}T${byType.get("hour")}:${byType.get("minute")}:${byType.get("second")}`;
}

