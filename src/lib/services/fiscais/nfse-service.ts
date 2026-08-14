export type NFSeEmitirParams = {
  referencia: string;
  natureza_operacao: 1 | 2 | 3 | 4 | 5 | 6;
  optante_simples_nacional: boolean;
  regime_tributario_simples_nacional?: 1 | 2 | 3;
  regime_especial_tributacao?: number | string;
  finalidade_emissao?: 0;
  consumidor_final?: 0 | 1;
  indicador_destinatario?: 0 | 1;
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
    codigo_indicador_operacao?: string;
    ibs_cbs_situacao_tributaria?: string;
    ibs_cbs_classificacao_tributaria?: string;
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
  natureza_operacao?: 1 | 2 | 3 | 4 | 5 | 6;
  iss_retido?: boolean;
  tributacao_iss?: 1 | 2 | 3 | 4;
  tipo_retencao_iss?: 1 | 2 | 3;
  finalidade_emissao?: 0;
  consumidor_final?: 0 | 1;
  indicador_destinatario?: 0 | 1;
  codigo_indicador_operacao?: string;
  ibs_cbs_situacao_tributaria?: string;
  ibs_cbs_classificacao_tributaria?: string;
  informacoes_complementares?: string;
};

export type NFSeItemEmissao = {
  servicoid: number;
  quantidade: number;
  valor: number;
  servico?: {
    descricao?: string | null;
  } | null;
};

export type NFSeModeloEmissao = "NACIONAL" | "MUNICIPAL_CABEDELO" | "MUNICIPAL_JOAO_PESSOA";

/**
 * Resolve o modelo de emissão da NFS-e a partir do regime tributário e do
 * código IBGE do município da empresa. Regra única, reaproveitada tanto por
 * rotas server (emissão, listagem de serviços) quanto pela tela de
 * configurações (client), que só decide qual seção de padrões exibir.
 */
export function identificarModeloEmissao(
  empresa: { codigomunicipio?: unknown; regimetributario?: unknown } | null | undefined,
): NFSeModeloEmissao | null {
  const codigoMunicipio = String(empresa?.codigomunicipio ?? "").replace(/\D/g, "");
  if (String(empresa?.regimetributario ?? "") === "4") return "NACIONAL";
  if (codigoMunicipio === "2503209") return "MUNICIPAL_CABEDELO";
  if (codigoMunicipio === "2507507") return "MUNICIPAL_JOAO_PESSOA";
  return null;
}

export function normalizarStatusNFSe(status: unknown, padrao = "PROCESSANDO") {
  const normalizado = String(status ?? "").trim().toLowerCase();
  const statusMap: Record<string, string> = {
    autorizado: "AUTORIZADA",
    autorizada: "AUTORIZADA",
    emitida: "AUTORIZADA",
    cancelado: "CANCELADA",
    cancelada: "CANCELADA",
    erro: "REJEITADA",
    erro_autorizacao: "REJEITADA",
    rejeitado: "REJEITADA",
    rejeitada: "REJEITADA",
    denegado: "DENEGADA",
    denegada: "DENEGADA",
    processando: "PROCESSANDO",
    processando_autorizacao: "PROCESSANDO",
  };
  return statusMap[normalizado] || (normalizado ? normalizado.toUpperCase() : padrao);
}

export class NFSeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NFSeValidationError";
  }
}

const textoObrigatorio = (value: unknown) => String(value ?? "").trim();
const somenteDigitos = (value: unknown) => textoObrigatorio(value).replace(/\D/g, "");

export type NFSePendenciaOrigem = "EMPRESA" | "CLIENTE" | "SERVICO";

export type NFSePendencia = {
  origem: NFSePendenciaOrigem;
  mensagem: string;
};

// A origem acompanha cada pendência para a tela de emissão saber o que ela
// consegue resolver ali mesmo — o cadastro do cliente abre em um dialog; os
// dados da empresa e do serviço ficam em outras telas.
export function listarPendenciasNFSe(
  os: any,
  empresa: any,
  itensServico: any | any[],
  modelo: NFSeModeloEmissao,
): NFSePendencia[] {
  const pendencias: NFSePendencia[] = [];
  const cliente = os?.cliente;
  const itens = Array.isArray(itensServico) ? itensServico : [itensServico];
  const documentoEmpresa = somenteDigitos(empresa?.cnpj);
  const municipioEmpresa = somenteDigitos(empresa?.codigomunicipio);
  const registrar = (origem: NFSePendenciaOrigem, mensagem: string) => {
    pendencias.push({ origem, mensagem });
  };

  if (documentoEmpresa.length !== 14) registrar("EMPRESA", "CNPJ da empresa com 14 dígitos");
  if (municipioEmpresa.length !== 7) registrar("EMPRESA", "código IBGE do município da empresa com 7 dígitos");
  if (!textoObrigatorio(empresa?.regimetributario)) registrar("EMPRESA", "regime tributário da empresa");
  if (modelo !== "NACIONAL" && !somenteDigitos(empresa?.inscricaomunicipal)) {
    registrar("EMPRESA", "inscrição municipal da empresa");
  }

  if (!cliente) {
    registrar("CLIENTE", "cliente/tomador vinculado à OS");
  } else {
    const documentoCliente = somenteDigitos(cliente.cpfcnpj);
    const municipioCliente = somenteDigitos(cliente.codigomunicipio);
    const cepCliente = somenteDigitos(cliente.cep);
    const ufCliente = textoObrigatorio(cliente.estado).toUpperCase();

    if (![11, 14].includes(documentoCliente.length)) registrar("CLIENTE", "CPF ou CNPJ do cliente com 11 ou 14 dígitos");
    if (!textoObrigatorio(cliente.nomerazaosocial)) registrar("CLIENTE", "nome ou razão social do cliente");
    if (!textoObrigatorio(cliente.endereco)) registrar("CLIENTE", "logradouro do cliente");
    if (!textoObrigatorio(cliente.endereconumero)) registrar("CLIENTE", "número do endereço do cliente");
    if (!textoObrigatorio(cliente.bairro)) registrar("CLIENTE", "bairro do cliente");
    if (municipioCliente.length !== 7) registrar("CLIENTE", "código IBGE do município do cliente com 7 dígitos");
    if (ufCliente.length !== 2) registrar("CLIENTE", "UF do cliente com 2 letras");
    if (cepCliente.length !== 8) registrar("CLIENTE", "CEP do cliente com 8 dígitos");
  }

  itens.forEach((itemServico, index) => {
    const quantidade = Number(itemServico?.quantidade);
    const descricao = textoObrigatorio(itemServico?.servico?.descricao);
    const identificador = itens.length > 1 ? ` do serviço ${index + 1}` : " do serviço";
    if (!Number.isFinite(quantidade) || quantidade <= 0) registrar("SERVICO", `quantidade${identificador} maior que zero`);
    if (!descricao) registrar("SERVICO", `descrição${identificador}`);
  });

  return pendencias;
}

export function validarDadosObrigatoriosNFSe(
  os: any,
  empresa: any,
  itensServico: any | any[],
  modelo: NFSeModeloEmissao,
): string[] {
  return listarPendenciasNFSe(os, empresa, itensServico, modelo).map((pendencia) => pendencia.mensagem);
}

function exigirDadosObrigatoriosNFSe(
  os: any,
  empresa: any,
  itensServico: any | any[],
  modelo: NFSeModeloEmissao,
) {
  const pendencias = validarDadosObrigatoriosNFSe(os, empresa, itensServico, modelo);
  if (pendencias.length > 0) {
    throw new NFSeValidationError(`Preencha os dados obrigatórios antes de emitir a NFS-e: ${pendencias.join(", ")}.`);
  }
}

function exigirCodigosFiscais(
  modelo: NFSeModeloEmissao,
  codigos: NFSeCodigosFiscais,
) {
  const digitos = (value: unknown) => somenteDigitos(value);
  const nbs = digitos(codigos.codigo_nbs);
  const codigoIndicadorOperacao = digitos(codigos.codigo_indicador_operacao);
  const aliquota = codigos.aliquota_iss;

  if (nbs && nbs.length !== 9) {
    throw new NFSeValidationError("Quando informado, o C\u00f3digo NBS deve possuir 9 d\u00edgitos.");
  }
  if (codigoIndicadorOperacao && codigoIndicadorOperacao.length !== 6) {
    throw new NFSeValidationError("Quando informado, o C\u00f3digo Indicador da Opera\u00e7\u00e3o deve possuir 6 d\u00edgitos.");
  }
  if (aliquota !== undefined && (!Number.isFinite(aliquota) || aliquota < 0 || aliquota > 100)) {
    throw new NFSeValidationError("Informe uma al\u00edquota de ISS v\u00e1lida entre 0 e 100%.");
  }

  if (modelo === "NACIONAL") {
    if (digitos(codigos.codigo_tributacao_nacional_iss).length !== 6) {
      throw new NFSeValidationError("Informe o C\u00f3digo de Tributa\u00e7\u00e3o Nacional do ISS com 6 d\u00edgitos.");
    }
    if (![1, 2, 3, 4].includes(Number(codigos.tributacao_iss))) {
      throw new NFSeValidationError("Selecione a tributa\u00e7\u00e3o do ISS.");
    }
    if (![1, 2, 3].includes(Number(codigos.tipo_retencao_iss))) {
      throw new NFSeValidationError("Selecione o tipo de reten\u00e7\u00e3o do ISS.");
    }
    if (codigos.finalidade_emissao !== 0) {
      throw new NFSeValidationError("Selecione a finalidade da emiss\u00e3o da NFS-e.");
    }
    if (![0, 1].includes(Number(codigos.consumidor_final))) {
      throw new NFSeValidationError("Informe se a opera\u00e7\u00e3o \u00e9 de consumo final.");
    }
    if (codigos.indicador_destinatario !== 0) {
      throw new NFSeValidationError("Confirme que o destinat\u00e1rio \u00e9 o pr\u00f3prio tomador.");
    }
    if (digitos(codigos.ibs_cbs_situacao_tributaria).length !== 3) {
      throw new NFSeValidationError("Informe o CST do IBS/CBS com 3 d\u00edgitos.");
    }
    if (digitos(codigos.ibs_cbs_classificacao_tributaria).length !== 6) {
      throw new NFSeValidationError("Informe a Classifica\u00e7\u00e3o Tribut\u00e1ria do IBS/CBS com 6 d\u00edgitos.");
    }
    return;
  }

  const itemLista = digitos(codigos.item_lista_servico);
  const cnae = digitos(codigos.codigo_cnae);
  if (itemLista.length < 4 || itemLista.length > 6) {
    throw new NFSeValidationError("Informe um Item da Lista de Servi\u00e7o v\u00e1lido, por exemplo 14.01.");
  }
  const cnaeValido = modelo === "MUNICIPAL_JOAO_PESSOA"
    ? cnae.length === 9
    : cnae.length >= 7 && cnae.length <= 9;
  if (!cnaeValido) {
    throw new NFSeValidationError(
      modelo === "MUNICIPAL_JOAO_PESSOA"
        ? "Informe a varia\u00e7\u00e3o do CNAE com 9 d\u00edgitos exigida por Jo\u00e3o Pessoa."
        : "Informe um CNAE com 7 a 9 d\u00edgitos.",
    );
  }
  if (aliquota === undefined) {
    throw new NFSeValidationError("Informe a al\u00edquota do ISS.");
  }
  if (![1, 2, 3, 4, 5, 6].includes(Number(codigos.natureza_operacao))) {
    throw new NFSeValidationError("Selecione a natureza da opera\u00e7\u00e3o.");
  }
  if (typeof codigos.iss_retido !== "boolean") {
    throw new NFSeValidationError("Informe se o ISS ser\u00e1 retido.");
  }

  if (modelo === "MUNICIPAL_CABEDELO") {
    const reforma = [
      codigos.finalidade_emissao,
      codigos.consumidor_final,
      codigos.indicador_destinatario,
      codigos.codigo_indicador_operacao,
      codigos.ibs_cbs_situacao_tributaria,
      codigos.ibs_cbs_classificacao_tributaria,
    ];
    const iniciouReforma = reforma.some((value) => value !== undefined && String(value).trim() !== "");
    if (iniciouReforma) {
      if (
        codigos.finalidade_emissao !== 0
        || ![0, 1].includes(Number(codigos.consumidor_final))
        || codigos.indicador_destinatario !== 0
      ) {
        throw new NFSeValidationError("Complete finalidade, consumo final e destinat\u00e1rio dos dados da Reforma Tribut\u00e1ria.");
      }
      if (
        digitos(codigos.ibs_cbs_situacao_tributaria).length !== 3
        || digitos(codigos.ibs_cbs_classificacao_tributaria).length !== 6
      ) {
        throw new NFSeValidationError("Complete o CST e a Classifica\u00e7\u00e3o Tribut\u00e1ria do IBS/CBS.");
      }
    }
  }
}

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
  informacoes_complementares?: string;
  valor_servico: number;
  tributacao_iss: 1 | 2 | 3 | 4;
  tipo_retencao_iss: 1 | 2 | 3;
  percentual_aliquota_relativa_municipio?: number;
  indicador_total_tributacao: "0";
  finalidade_emissao: 0;
  consumidor_final: 0 | 1;
  indicador_destinatario: 0 | 1;
  codigo_indicador_operacao?: string;
  ibs_cbs_situacao_tributaria: string;
  ibs_cbs_classificacao_tributaria: string;
};

function validarItensEmissao(itens: NFSeItemEmissao[]) {
  if (itens.length === 0) {
    throw new NFSeValidationError("Selecione ao menos um serviço para emitir a NFS-e.");
  }

  const ids = new Set<number>();
  itens.forEach((item, index) => {
    if (!Number.isInteger(item.servicoid) || item.servicoid <= 0 || ids.has(item.servicoid)) {
      throw new NFSeValidationError(`O serviço ${index + 1} possui um identificador inválido ou duplicado.`);
    }
    ids.add(item.servicoid);

    if (!Number.isFinite(item.quantidade) || item.quantidade <= 0) {
      throw new NFSeValidationError(`Informe uma quantidade válida para o serviço ${index + 1}.`);
    }
    if (!Number.isFinite(item.valor) || item.valor <= 0) {
      throw new NFSeValidationError(`Informe um valor maior que zero para o serviço ${index + 1}.`);
    }
    if (!textoObrigatorio(item.servico?.descricao)) {
      throw new NFSeValidationError(`Informe a descrição do serviço ${index + 1}.`);
    }
  });
}

function montarDiscriminacaoServicos(
  osId: number,
  itens: NFSeItemEmissao[],
  informacoesComplementares?: string,
  limiteCaracteres = 2000,
) {
  validarItensEmissao(itens);
  const linhas = itens.map((item, index) => {
    const descricao = textoObrigatorio(item.servico?.descricao);
    const quantidade = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 }).format(item.quantidade);
    const valor = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(item.valor);
    return `${index + 1}. ${descricao} — ${quantidade} un. — ${valor}`;
  });
  const blocos = [`OS #${osId}`, ...linhas];
  if (informacoesComplementares) {
    blocos.push(`Informações complementares: ${informacoesComplementares}`);
  }
  const discriminacao = blocos.join("\n");
  if (discriminacao.length > limiteCaracteres) {
    const origem = informacoesComplementares ? "dos serviços e das informações complementares" : "dos serviços";
    throw new NFSeValidationError(
      `A discriminação consolidada ${origem} ultrapassa ${limiteCaracteres} caracteres. Reduza o texto complementar ou a quantidade de serviços.`,
    );
  }
  return discriminacao;
}

function validarInformacoesComplementares(value?: string) {
  const informacoes = textoObrigatorio(value);
  if (informacoes.length > 2000) {
    throw new NFSeValidationError("As informações complementares devem possuir no máximo 2.000 caracteres.");
  }
  return informacoes || undefined;
}

function valorTotalServicos(itens: NFSeItemEmissao[]) {
  return Math.round(itens.reduce((total, item) => total + item.valor, 0) * 100) / 100;
}

function criarReferencia(osId: number, itens: NFSeItemEmissao[]) {
  const ids = itens.map((item) => item.servicoid).sort((a, b) => a - b).join("-");
  return `OS_${osId}_SRVS_${ids}_${Date.now()}`;
}

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

    const dados = Object.fromEntries(
      Object.entries(params).filter(([chave]) => chave !== "referencia"),
    );
    const payload = {
      ...dados,
      data_emissao: dataEmissao,
    };

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
        payload,
      };
    }

    return {
      ok: true,
      status: json?.status || "processando_autorizacao",
      referencia: json?.ref,
      payload,
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
      return { ok: false, message: json?.mensagem || json?.codigo || `Erro ${res.status} ao emitir NFS-e Nacional`, erros, payload };
    }
    return { ok: true, status: json?.status || "processando_autorizacao", referencia: json?.ref || referencia, payload };
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

    const cnpj = somenteDigitos(empresa?.cnpj);
    const inscricaoMunicipal = somenteDigitos(empresa?.inscricaomunicipal);
    const codigoMunicipio = somenteDigitos(empresa?.codigomunicipio);
    const cep = somenteDigitos(empresa?.cep);
    const camposObrigatorios = [
      cnpj.length === 14 ? null : "CNPJ com 14 dígitos",
      inscricaoMunicipal ? null : "inscrição municipal",
      textoObrigatorio(empresa?.razaosocial) ? null : "razão social",
      textoObrigatorio(empresa?.endereco) ? null : "logradouro",
      textoObrigatorio(empresa?.numero) ? null : "número do endereço",
      textoObrigatorio(empresa?.bairro) ? null : "bairro",
      codigoMunicipio.length === 7 ? null : "código IBGE do município com 7 dígitos",
      textoObrigatorio(empresa?.uf).length === 2 ? null : "UF com 2 letras",
      cep.length === 8 ? null : "CEP com 8 dígitos",
      textoObrigatorio(empresa?.regimetributario) ? null : "regime tributário",
    ].filter((campo): campo is string => Boolean(campo));

    if (camposObrigatorios.length > 0) {
      throw new NFSeValidationError(`Preencha os dados obrigatórios da empresa: ${camposObrigatorios.join(", ")}.`);
    }

    const payload: any = {
      cnpj: cnpj,
      inscricao_municipal: inscricaoMunicipal,
      razao_social: textoObrigatorio(empresa.razaosocial),
      logradouro: textoObrigatorio(empresa.endereco),
      numero: textoObrigatorio(empresa.numero),
      bairro: textoObrigatorio(empresa.bairro),
      codigo_municipio: codigoMunicipio,
      uf: textoObrigatorio(empresa.uf).toUpperCase(),
      cep,
      regime_tributario: empresa.regimetributario,
      enviar_email_destinatario: false,
    };

    const inscricaoEstadual = somenteDigitos(empresa.inscricaoestadual);
    const telefone = somenteDigitos(empresa.telefone);
    if (inscricaoEstadual) payload.inscricao_estadual = inscricaoEstadual;
    if (textoObrigatorio(empresa.nomefantasia)) payload.nome_fantasia = textoObrigatorio(empresa.nomefantasia);
    if (textoObrigatorio(empresa.email)) payload.email = textoObrigatorio(empresa.email);
    if (telefone) payload.telefone = telefone;
    if (textoObrigatorio(empresa.complemento)) payload.complemento = textoObrigatorio(empresa.complemento);

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
    itensServico: NFSeItemEmissao[],
    codigosFiscais: NFSeCodigosFiscais,
  ): NFSeEmitirParams {
    exigirDadosObrigatoriosNFSe(os, empresa, itensServico, "MUNICIPAL_JOAO_PESSOA");
    exigirCodigosFiscais("MUNICIPAL_JOAO_PESSOA", codigosFiscais);
    const cliente = os.cliente;
    const documento = somenteDigitos(cliente.cpfcnpj);
    const informacoesComplementares = validarInformacoesComplementares(codigosFiscais.informacoes_complementares);
    const discriminacao = montarDiscriminacaoServicos(os.id, itensServico, informacoesComplementares);

    return {
      referencia: criarReferencia(os.id, itensServico),
      natureza_operacao: codigosFiscais.natureza_operacao as 1 | 2 | 3 | 4 | 5 | 6,
      optante_simples_nacional: empresa.regimetributario === "1",
      regime_especial_tributacao: empresa.regimetributario === "1" ? 6 : undefined,
      prestador: {
        cnpj: somenteDigitos(empresa.cnpj),
        inscricao_municipal: somenteDigitos(empresa.inscricaomunicipal),
        codigo_municipio: somenteDigitos(empresa.codigomunicipio),
      },
      tomador: {
        cpf: documento.length === 11 ? documento : undefined,
        cnpj: documento.length === 14 ? documento : undefined,
        razao_social: textoObrigatorio(cliente.nomerazaosocial),
        email: textoObrigatorio(cliente.email) || undefined,
        endereco: {
          logradouro: textoObrigatorio(cliente.endereco).substring(0, 100),
          numero: textoObrigatorio(cliente.endereconumero),
          complemento: textoObrigatorio(cliente.enderecocomplemento).substring(0, 100) || undefined,
          bairro: textoObrigatorio(cliente.bairro).substring(0, 60),
          codigo_municipio: somenteDigitos(cliente.codigomunicipio),
          uf: textoObrigatorio(cliente.estado).toUpperCase(),
          cep: somenteDigitos(cliente.cep),
        },
      },
      servico: {
        aliquota: Number(codigosFiscais.aliquota_iss),
        discriminacao,
        iss_retido: Boolean(codigosFiscais.iss_retido),
        item_lista_servico: String(codigosFiscais.item_lista_servico || "").trim(),
        codigo_cnae: String(codigosFiscais.codigo_cnae || "").replace(/\D/g, ""),
        codigo_nbs: codigosFiscais.codigo_nbs || undefined,
        valor_servicos: valorTotalServicos(itensServico),
      },
    };
  }

  mapearOSParaFocusCabedelo(
    os: any,
    empresa: any,
    itensServico: NFSeItemEmissao[],
    codigosFiscais: NFSeCodigosFiscais,
  ): NFSeEmitirParams {
    exigirDadosObrigatoriosNFSe(os, empresa, itensServico, "MUNICIPAL_CABEDELO");
    exigirCodigosFiscais("MUNICIPAL_CABEDELO", codigosFiscais);
    const cliente = os.cliente;
    const documento = somenteDigitos(cliente.cpfcnpj);
    const cnae = String(codigosFiscais.codigo_cnae || "").replace(/\D/g, "");
    const itemLista = String(codigosFiscais.item_lista_servico || "").trim();
    const informacoesComplementares = validarInformacoesComplementares(codigosFiscais.informacoes_complementares);
    const discriminacao = montarDiscriminacaoServicos(os.id, itensServico, informacoesComplementares);

    if (!cnae) throw new Error("Informe o CNAE do serviço ou da empresa para emitir NFS-e em Cabedelo.");
    if (!itemLista) throw new Error("Informe o item da lista de serviço para emitir NFS-e em Cabedelo.");

    return {
      referencia: criarReferencia(os.id, itensServico),
      natureza_operacao: codigosFiscais.natureza_operacao as 1 | 2 | 3 | 4 | 5 | 6,
      optante_simples_nacional: String(empresa.regimetributario) === "1",
      regime_tributario_simples_nacional: String(empresa.regimetributario) === "1" ? 1 : undefined,
      regime_especial_tributacao: String(empresa.regimetributario) === "1" ? 6 : undefined,
      finalidade_emissao: codigosFiscais.finalidade_emissao,
      consumidor_final: codigosFiscais.consumidor_final,
      indicador_destinatario: codigosFiscais.indicador_destinatario,
      prestador: {
        cnpj: somenteDigitos(empresa.cnpj),
        inscricao_municipal: somenteDigitos(empresa.inscricaomunicipal),
        codigo_municipio: somenteDigitos(empresa.codigomunicipio),
      },
      tomador: {
        cpf: documento.length === 11 ? documento : undefined,
        cnpj: documento.length === 14 ? documento : undefined,
        razao_social: textoObrigatorio(cliente.nomerazaosocial),
        email: textoObrigatorio(cliente.email) || undefined,
        telefone: somenteDigitos(cliente.telefone) || undefined,
        endereco: {
          logradouro: textoObrigatorio(cliente.endereco).substring(0, 100),
          numero: textoObrigatorio(cliente.endereconumero),
          complemento: textoObrigatorio(cliente.enderecocomplemento).substring(0, 100) || undefined,
          bairro: textoObrigatorio(cliente.bairro).substring(0, 60),
          codigo_municipio: somenteDigitos(cliente.codigomunicipio),
          uf: textoObrigatorio(cliente.estado).toUpperCase(),
          cep: somenteDigitos(cliente.cep),
        },
      },
      servico: {
        aliquota: Number(codigosFiscais.aliquota_iss),
        discriminacao,
        iss_retido: Boolean(codigosFiscais.iss_retido),
        item_lista_servico: itemLista,
        codigo_cnae: cnae,
        codigo_nbs: codigosFiscais.codigo_nbs || undefined,
        codigo_indicador_operacao: codigosFiscais.codigo_indicador_operacao || undefined,
        ibs_cbs_situacao_tributaria: codigosFiscais.ibs_cbs_situacao_tributaria || undefined,
        ibs_cbs_classificacao_tributaria: codigosFiscais.ibs_cbs_classificacao_tributaria || undefined,
        valor_servicos: valorTotalServicos(itensServico),
      },
    };
  }

  mapearOSParaFocusNacional(
    os: any,
    empresa: any,
    itensServico: NFSeItemEmissao[],
    codigosFiscais: NFSeCodigosFiscais,
  ): NFSeNacionalEmitirParams {
    exigirDadosObrigatoriosNFSe(os, empresa, itensServico, "NACIONAL");
    exigirCodigosFiscais("NACIONAL", codigosFiscais);
    const cliente = os.cliente;
    const documento = somenteDigitos(cliente.cpfcnpj);
    const hoje = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
    // descricao_servico (xDescServ) do DPS Nacional aceita no máximo 1.000 caracteres.
    const discriminacao = montarDiscriminacaoServicos(os.id, itensServico, undefined, 1000);
    const informacoesComplementares = validarInformacoesComplementares(codigosFiscais.informacoes_complementares);
    return {
      referencia: criarReferencia(os.id, itensServico),
      data_competencia: hoje,
      codigo_municipio_emissora: Number(somenteDigitos(empresa.codigomunicipio)),
      cnpj_prestador: somenteDigitos(empresa.cnpj),
      inscricao_municipal_prestador: somenteDigitos(empresa.inscricaomunicipal) || undefined,
      codigo_opcao_simples_nacional: 2,
      regime_especial_tributacao: 0,
      cpf_tomador: documento.length === 11 ? documento : undefined,
      cnpj_tomador: documento.length === 14 ? documento : undefined,
      razao_social_tomador: textoObrigatorio(cliente.nomerazaosocial),
      codigo_municipio_tomador: Number(somenteDigitos(cliente.codigomunicipio)),
      cep_tomador: somenteDigitos(cliente.cep),
      logradouro_tomador: textoObrigatorio(cliente.endereco),
      numero_tomador: textoObrigatorio(cliente.endereconumero),
      complemento_tomador: textoObrigatorio(cliente.enderecocomplemento) || undefined,
      bairro_tomador: textoObrigatorio(cliente.bairro),
      email_tomador: textoObrigatorio(cliente.email) || undefined,
      codigo_municipio_prestacao: somenteDigitos(empresa.codigomunicipio),
      codigo_tributacao_nacional_iss: String(codigosFiscais.codigo_tributacao_nacional_iss || "").replace(/\D/g, ""),
      codigo_tributacao_municipal_iss: codigosFiscais.codigo_tributario_municipio || undefined,
      codigo_nbs: codigosFiscais.codigo_nbs
        ? String(codigosFiscais.codigo_nbs).replace(/\D/g, "")
        : undefined,
      descricao_servico: discriminacao,
      informacoes_complementares: informacoesComplementares,
      valor_servico: valorTotalServicos(itensServico),
      tributacao_iss: codigosFiscais.tributacao_iss as 1 | 2 | 3 | 4,
      tipo_retencao_iss: codigosFiscais.tipo_retencao_iss as 1 | 2 | 3,
      percentual_aliquota_relativa_municipio: codigosFiscais.aliquota_iss,
      indicador_total_tributacao: "0",
      finalidade_emissao: codigosFiscais.finalidade_emissao as 0,
      consumidor_final: codigosFiscais.consumidor_final as 0 | 1,
      indicador_destinatario: codigosFiscais.indicador_destinatario as 0 | 1,
      codigo_indicador_operacao: codigosFiscais.codigo_indicador_operacao || undefined,
      ibs_cbs_situacao_tributaria: String(codigosFiscais.ibs_cbs_situacao_tributaria || ""),
      ibs_cbs_classificacao_tributaria: String(codigosFiscais.ibs_cbs_classificacao_tributaria || ""),
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

