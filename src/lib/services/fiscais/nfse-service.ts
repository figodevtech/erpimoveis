import { extractNfseUrls } from "@/lib/nfse-urls";
import {
  isValidCnpj,
  isValidCpf,
  normalizeCnpj,
  normalizeCpf,
} from "@/lib/fiscal-identifiers";
import {
  dataDoDiaNFSe,
  resolverPoliticaNFSe,
  type NFSeModeloEmissao,
  type PoliticaNFSe,
} from "./nfse-politica";

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
  /** cTribMun da DPS Nacional: 3 posições. Não é o código do emissor municipal antigo. */
  codigo_tributacao_municipal_iss?: string;
  codigo_nbs?: string;
  aliquota_iss?: number;
  /** regEspTrib da DPS Nacional. Vem do padrão da empresa, não da tela de emissão. */
  regime_especial_tributacao?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 9;
  /** regApTribSN da DPS Nacional, só para ME/EPP do Simples. Vem do padrão da empresa. */
  regime_apuracao_simples_nacional?: 1 | 2 | 3;
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
  /**
   * A OS de onde esta linha de servico veio. So e preenchido na emissao
   * agrupada; sozinho, o item pertence a OS ancora e a discriminacao sai
   * exatamente como sempre saiu.
   */
  ordemServicoId?: number | null;
  /** Texto livre da linha da OS (`osservico.descricao`), não o nome do cadastro. */
  descricaoItem?: string | null;
  servico?: {
    descricao?: string | null;
  } | null;
};

export type { NFSeModeloEmissao, PoliticaNFSe } from "./nfse-politica";

/**
 * Atalho para quem só precisa do modelo. A decisão mora em
 * `resolverPoliticaNFSe`: o modelo depende da data e dos itens da nota, então
 * eles são obrigatórios aqui — sem eles a resposta seria a de antes da
 * migração de João Pessoa.
 */
export function identificarModeloEmissao(
  empresa: { codigomunicipio?: unknown; regimetributario?: unknown } | null | undefined,
  contexto: { dataCompetencia: string; itensListaServico?: Array<string | null | undefined> },
): NFSeModeloEmissao | null {
  return resolverPoliticaNFSe({
    codigoMunicipio: empresa?.codigomunicipio,
    regimeTributario: empresa?.regimetributario,
    ...contexto,
  })?.modelo ?? null;
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

function documentoTomador(cliente: any) {
  const valor = cliente?.cpfcnpj;
  const tipo = String(cliente?.tipopessoa ?? "").toUpperCase();
  const cnpj = normalizeCnpj(valor);
  if (tipo === "JURIDICA" || /[A-Z]/.test(cnpj) || cnpj.length === 14) {
    return { tipo: "CNPJ" as const, valor: cnpj, valido: isValidCnpj(cnpj) };
  }
  const cpf = normalizeCpf(valor);
  return { tipo: "CPF" as const, valor: cpf, valido: isValidCpf(cpf) };
}

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
  const documentoEmpresa = normalizeCnpj(empresa?.cnpj);
  const municipioEmpresa = somenteDigitos(empresa?.codigomunicipio);
  const registrar = (origem: NFSePendenciaOrigem, mensagem: string) => {
    pendencias.push({ origem, mensagem });
  };

  if (!isValidCnpj(documentoEmpresa)) registrar("EMPRESA", "CNPJ numérico ou alfanumérico válido da empresa");
  if (municipioEmpresa.length !== 7) registrar("EMPRESA", "código IBGE do município da empresa com 7 dígitos");
  if (!textoObrigatorio(empresa?.regimetributario)) registrar("EMPRESA", "regime tributário da empresa");
  if (modelo !== "NACIONAL" && !somenteDigitos(empresa?.inscricaomunicipal)) {
    registrar("EMPRESA", "inscrição municipal da empresa");
  }

  if (!cliente) {
    registrar("CLIENTE", "cliente/tomador vinculado à OS");
  } else {
    const documentoCliente = documentoTomador(cliente);
    const municipioCliente = somenteDigitos(cliente.codigomunicipio);
    const cepCliente = somenteDigitos(cliente.cep);
    const ufCliente = textoObrigatorio(cliente.estado).toUpperCase();

    if (!documentoCliente.valido) registrar("CLIENTE", "CPF ou CNPJ numérico/alfanumérico válido do cliente");
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

/** O que a valida\u00e7\u00e3o precisa saber da pol\u00edtica: o modelo e se a RTC \u00e9 exigida. */
export type RegraCodigosNFSe = Pick<PoliticaNFSe, "modelo" | "exigeRtc">;

/** Algum campo do grupo da Reforma Tribut\u00e1ria foi preenchido. */
function informouGrupoRtc(codigos: NFSeCodigosFiscais) {
  return [
    codigos.finalidade_emissao,
    codigos.consumidor_final,
    codigos.indicador_destinatario,
    codigos.codigo_indicador_operacao,
    codigos.ibs_cbs_situacao_tributaria,
    codigos.ibs_cbs_classificacao_tributaria,
  ].some((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

/**
 * Valida\u00e7\u00e3o \u00fanica dos c\u00f3digos fiscais da NFS-e \u2014 a rota de emiss\u00e3o e os
 * mapeadores chamam esta mesma fun\u00e7\u00e3o. Devolve a primeira pend\u00eancia, ou null.
 *
 * O grupo da Reforma Tribut\u00e1ria (finalidade, consumo final, destinat\u00e1rio, cIndOp,
 * CST e cClassTrib) \u00e9 exigido quando a POL\u00cdTICA diz, e n\u00e3o pelo modelo: MEI e
 * Simples no padr\u00e3o Nacional ficam dispensados at\u00e9 2027, o regime regular n\u00e3o.
 * Quando n\u00e3o \u00e9 exigido mas foi iniciado, precisa sair completo \u2014 meio grupo \u00e9
 * rejei\u00e7\u00e3o certa.
 */
export function conferirCodigosFiscaisNFSe(
  regra: RegraCodigosNFSe,
  codigos: NFSeCodigosFiscais,
): string | null {
  const digitos = (value: unknown) => somenteDigitos(value);
  const nbs = digitos(codigos.codigo_nbs);
  const codigoIndicadorOperacao = digitos(codigos.codigo_indicador_operacao);
  const aliquota = codigos.aliquota_iss;
  const { modelo } = regra;

  if (nbs && nbs.length !== 9) return "Quando informado, o C\u00f3digo NBS deve possuir 9 d\u00edgitos.";
  if (codigoIndicadorOperacao && codigoIndicadorOperacao.length !== 6) {
    return "Quando informado, o C\u00f3digo Indicador da Opera\u00e7\u00e3o deve possuir 6 d\u00edgitos.";
  }
  if (aliquota !== undefined && (!Number.isFinite(aliquota) || aliquota < 0 || aliquota > 100)) {
    return "Informe uma al\u00edquota de ISS v\u00e1lida entre 0 e 100%.";
  }
  if (String(codigos.informacoes_complementares ?? "").trim().length > 2000) {
    return "As informa\u00e7\u00f5es complementares devem possuir no m\u00e1ximo 2.000 caracteres.";
  }

  const conferirGrupoRtc = (exigido: boolean) => {
    if (!exigido && !informouGrupoRtc(codigos)) return null;
    if (codigos.finalidade_emissao !== 0) return "Selecione a finalidade da emiss\u00e3o da NFS-e.";
    if (![0, 1].includes(Number(codigos.consumidor_final))) return "Informe se a opera\u00e7\u00e3o \u00e9 de consumo final.";
    if (codigos.indicador_destinatario !== 0) return "Confirme que o destinat\u00e1rio \u00e9 o pr\u00f3prio tomador.";
    if (exigido && codigoIndicadorOperacao.length !== 6) {
      return "Informe o C\u00f3digo Indicador da Opera\u00e7\u00e3o (cIndOp) com 6 d\u00edgitos.";
    }
    if (digitos(codigos.ibs_cbs_situacao_tributaria).length !== 3) return "Informe o CST do IBS/CBS com 3 d\u00edgitos.";
    if (digitos(codigos.ibs_cbs_classificacao_tributaria).length !== 6) {
      return "Informe a Classifica\u00e7\u00e3o Tribut\u00e1ria do IBS/CBS com 6 d\u00edgitos.";
    }
    return null;
  };

  if (modelo === "NACIONAL") {
    if (digitos(codigos.codigo_tributacao_nacional_iss).length !== 6) {
      return "Informe o C\u00f3digo de Tributa\u00e7\u00e3o Nacional do ISS com 6 d\u00edgitos.";
    }
    const municipal = String(codigos.codigo_tributacao_municipal_iss ?? "").trim();
    if (municipal && !/^\d{3}$/.test(municipal)) {
      return "Quando informado, o C\u00f3digo de Tributa\u00e7\u00e3o Municipal do padr\u00e3o Nacional deve possuir 3 d\u00edgitos.";
    }
    if (![1, 2, 3, 4].includes(Number(codigos.tributacao_iss))) return "Selecione a tributa\u00e7\u00e3o do ISS.";
    if (![1, 2, 3].includes(Number(codigos.tipo_retencao_iss))) return "Selecione o tipo de reten\u00e7\u00e3o do ISS.";
    return conferirGrupoRtc(regra.exigeRtc);
  }

  const itemLista = digitos(codigos.item_lista_servico);
  const cnae = digitos(codigos.codigo_cnae);
  if (itemLista.length < 4 || itemLista.length > 6) {
    return "Informe um Item da Lista de Servi\u00e7o v\u00e1lido, por exemplo 14.01.";
  }
  const cnaeValido = modelo === "MUNICIPAL_JOAO_PESSOA"
    ? cnae.length === 9
    : cnae.length >= 7 && cnae.length <= 9;
  if (!cnaeValido) {
    return modelo === "MUNICIPAL_JOAO_PESSOA"
      ? "Informe a varia\u00e7\u00e3o do CNAE com 9 d\u00edgitos exigida por Jo\u00e3o Pessoa."
      : "Informe um CNAE com 7 a 9 d\u00edgitos.";
  }
  if (aliquota === undefined) return "Informe a al\u00edquota do ISS.";
  if (![1, 2, 3, 4, 5, 6].includes(Number(codigos.natureza_operacao))) return "Selecione a natureza da opera\u00e7\u00e3o.";
  if (typeof codigos.iss_retido !== "boolean") return "Informe se o ISS ser\u00e1 retido.";

  if (modelo === "MUNICIPAL_CABEDELO") {
    const pendencia = conferirGrupoRtc(false);
    if (pendencia) {
      return pendencia.includes("CST") || pendencia.includes("Classifica\u00e7\u00e3o")
        ? "Complete o CST e a Classifica\u00e7\u00e3o Tribut\u00e1ria do IBS/CBS."
        : "Complete finalidade, consumo final e destinat\u00e1rio dos dados da Reforma Tribut\u00e1ria.";
    }
  }
  return null;
}

function exigirCodigosFiscais(regra: RegraCodigosNFSe, codigos: NFSeCodigosFiscais) {
  const pendencia = conferirCodigosFiscaisNFSe(regra, codigos);
  if (pendencia) throw new NFSeValidationError(pendencia);
}

/**
 * Como o prestador se declara na DPS Nacional, a partir do CRT da empresa.
 *
 * Valores de opSimpNac (tabela de campos da Focus / leiaute nacional):
 * 1 = N\u00e3o optante, 2 = MEI, 3 = ME/EPP. Antes isto ia fixo em 2, e uma empresa
 * do regime normal sairia declarada como MEI.
 *
 * regApTribSN s\u00f3 existe para ME/EPP (opSimpNac 3):
 * - CRT 1: o ISS \u00e9 recolhido dentro do DAS (LC 123/2006, art. 13, VIII), ent\u00e3o
 *   o padr\u00e3o \u00e9 1; a empresa pode cadastrar outro valor quando a apura\u00e7\u00e3o dela
 *   for diferente.
 * - CRT 2 (excesso de sublimite): o recolhimento fora do Simples depende de qual
 *   limite foi excedido \u2014 2 ou 3. O ERP n\u00e3o tem como saber, ent\u00e3o exige que a
 *   empresa cadastre no padr\u00e3o Nacional.
 */
export function opcaoSimplesNacionalDoPrestador(
  regimeTributario: unknown,
  regimeApuracaoConfigurado?: unknown,
): { codigo_opcao_simples_nacional: 1 | 2 | 3; regime_tributario_simples_nacional?: 1 | 2 | 3 } {
  const regime = String(regimeTributario ?? "").trim();
  const apuracao = [1, 2, 3].includes(Number(regimeApuracaoConfigurado))
    ? Number(regimeApuracaoConfigurado) as 1 | 2 | 3
    : undefined;

  if (regime === "3") return { codigo_opcao_simples_nacional: 1 };
  if (regime === "4") return { codigo_opcao_simples_nacional: 2 };
  if (regime === "1") {
    return { codigo_opcao_simples_nacional: 3, regime_tributario_simples_nacional: apuracao ?? 1 };
  }
  if (regime === "2") {
    if (!apuracao) {
      throw new NFSeValidationError(
        "Empresa do Simples com excesso de sublimite (CRT 2): cadastre o regime de apura\u00e7\u00e3o do Simples Nacional no padr\u00e3o da NFS-e Nacional.",
      );
    }
    return { codigo_opcao_simples_nacional: 3, regime_tributario_simples_nacional: apuracao };
  }
  throw new NFSeValidationError("Informe o regime tribut\u00e1rio da empresa antes de emitir a NFS-e Nacional.");
}

/**
 * Símbolos comuns fora do Latin-1 e o equivalente que o leiaute aceita. O "•"
 * vem do bloco do alvo ("Placa: X • Marca: Y"), o "—" da discriminação.
 */
const SUBSTITUICOES_DPS: Record<string, string> = {
  "•": "-", "‣": "-", "◦": "-", "—": "-", "–": "-", "‒": "-", "−": "-",
  "“": "\"", "”": "\"", "„": "\"", "‘": "'", "’": "'", "‚": "'",
  "…": "...", "€": "EUR", "™": "TM", "\t": " ",
};

const caractereDaDps = (caractere: string) => {
  const codigo = caractere.codePointAt(0) ?? 0;
  return codigo >= 0x20 && codigo <= 0xff && !(codigo >= 0x7f && codigo <= 0x9f);
};

/**
 * Texto livre no charset da DPS Nacional.
 *
 * Os campos de texto do leiaute (xInfComp, entre outros) seguem o padrão
 * `[!-ÿ]{1}[ -ÿ]{0,}[!-ÿ]{1}`: só caracteres de 0x20 a 0xFF, sem espaço nas
 * pontas — e portanto sem quebra de linha. A Demir teve a nota 138 (OS 525,
 * 02/10/2026) recusada por schema por causa de um "\n" em
 * `informacoes_complementares`; o emissor municipal antigo aceitava.
 *
 * - `separador`: cada linha vira um trecho separado por " | " (xInfComp);
 * - `manter`: preserva as quebras (xDescServ, que as aceita: na mesma nota 138
 *   a descrição com quebras passou e só o xInfComp foi recusado).
 *
 * Acentos do português ficam (estão no Latin-1). Símbolos conhecidos viram o
 * equivalente; o resto fora da faixa é decomposto ou retirado — antes que a
 * Focus troque por outro caractere, como trocou o "•" por "º".
 */
export function textoParaDpsNacional(
  valor: unknown,
  quebraDeLinha: "separador" | "manter",
): string {
  const normalizado = String(valor ?? "").replace(/\r\n?/g, "\n").normalize("NFC");
  const convertido = [...normalizado].map((caractere) => {
    if (caractere === "\n") return caractere;
    const substituto = SUBSTITUICOES_DPS[caractere];
    if (substituto !== undefined) return substituto;
    if (caractereDaDps(caractere)) return caractere;
    const decomposto = caractere.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    return [...decomposto].every(caractereDaDps) ? decomposto : "";
  }).join("");

  const linhas = convertido.split("\n").map((linha) => linha.replace(/ {2,}/g, " ").trim());
  return quebraDeLinha === "separador"
    ? linhas.filter(Boolean).join(" | ")
    : linhas.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export type NFSeNacionalEmitirParams = {
  referencia: string;
  data_competencia: string;
  codigo_municipio_emissora: number;
  cnpj_prestador: string;
  inscricao_municipal_prestador?: string;
  codigo_opcao_simples_nacional: 1 | 2 | 3;
  regime_tributario_simples_nacional?: 1 | 2 | 3;
  regime_especial_tributacao: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 9;
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
  // Grupo da Reforma Tributária: presente quando a política exige ou quando a
  // empresa preencheu. Ausente não vira campo vazio no JSON.
  finalidade_emissao?: 0;
  consumidor_final?: 0 | 1;
  indicador_destinatario?: 0 | 1;
  codigo_indicador_operacao?: string;
  ibs_cbs_situacao_tributaria?: string;
  ibs_cbs_classificacao_tributaria?: string;
};

function validarItensEmissao(itens: NFSeItemEmissao[]) {
  if (itens.length === 0) {
    throw new NFSeValidationError("Selecione ao menos um serviço para emitir a NFS-e.");
  }

  /*
   * A identidade de uma linha de serviço é o par (OS, serviço), não o serviço
   * sozinho: `osservico` tem PK (ordemservicoid, servicoid), então o mesmo
   * serviço do catálogo aparece no máximo uma vez POR OS — e legitimamente em
   * várias OS diferentes.
   *
   * Enquanto a nota cobria uma OS só, comparar `servicoid` dava no mesmo. Numa
   * nota agrupada não dá: duas OS com "Revisão completa" são duas linhas
   * distintas, e recusá-las como duplicadas impediria justamente o caso mais
   * comum de agrupamento — o mesmo serviço repetido em várias ordens.
   */
  const chaves = new Set<string>();
  itens.forEach((item, index) => {
    const chave = `${item.ordemServicoId ?? "ancora"}:${item.servicoid}`;
    if (!Number.isInteger(item.servicoid) || item.servicoid <= 0) {
      throw new NFSeValidationError(`O serviço ${index + 1} possui um identificador inválido.`);
    }
    if (chaves.has(chave)) {
      throw new NFSeValidationError(
        item.ordemServicoId
          ? `O serviço ${item.servicoid} da OS ${item.ordemServicoId} foi informado mais de uma vez.`
          : `O serviço ${index + 1} foi informado mais de uma vez.`,
      );
    }
    chaves.add(chave);

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

/**
 * A descrição escrita na linha da OS (`osservico.descricao`), quando ela
 * acrescenta algo ao nome do serviço do cadastro. Mesma regra da impressão da
 * OS: repetir o mesmo texto não vira linha nova.
 */
export function descricaoComplementarDoItem(
  descricaoItem: unknown,
  descricaoCadastro: unknown,
): string | null {
  // A discriminação é numerada por item, e uma quebra no meio do texto livre
  // faria a linha seguinte parecer um item novo.
  const complemento = textoObrigatorio(descricaoItem).replace(/\s+/g, " ");
  if (!complemento) return null;
  const cadastro = textoObrigatorio(descricaoCadastro);
  if (complemento.toLocaleLowerCase("pt-BR") === cadastro.toLocaleLowerCase("pt-BR")) return null;
  return complemento;
}

/**
 * Exportada porque e ela que decide o texto que vai para o documento do
 * tomador, e porque o limite de caracteres (1.000 no padrao Nacional) e o
 * gargalo real do agrupamento: e o que decide quantas OS cabem numa nota.
 */
export function montarDiscriminacaoServicos(
  osId: number,
  itens: NFSeItemEmissao[],
  informacoesComplementares?: string,
  limiteCaracteres = 2000,
) {
  validarItensEmissao(itens);

  // Uma nota pode cobrir servicos de varias OS. Cada uma ganha seu cabecalho e
  // a numeracao recomeca dentro dela — sem isso o tomador le uma lista corrida
  // e nao sabe qual servico veio de qual ordem. Com uma OS so, o resultado e
  // identico ao de sempre.
  const grupos = new Map<number, NFSeItemEmissao[]>();
  for (const item of itens) {
    const chave = Number(item.ordemServicoId ?? osId);
    const atuais = grupos.get(chave) ?? [];
    atuais.push(item);
    grupos.set(chave, atuais);
  }

  const linhaDoItem = (item: NFSeItemEmissao, index: number) => {
    const descricao = textoObrigatorio(item.servico?.descricao);
    const quantidade = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 }).format(item.quantidade);
    const valor = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(item.valor);
    const complemento = descricaoComplementarDoItem(item.descricaoItem, descricao);
    const linha = `${index + 1}. ${descricao} — ${quantidade} un. — ${valor}`;
    return complemento ? [linha, `   ${complemento}`] : [linha];
  };

  const blocos = [...grupos.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([ordemId, itensDaOrdem]) => [
      `OS #${ordemId}`,
      ...itensDaOrdem.flatMap((item, index) => linhaDoItem(item, index)),
    ]);
  if (informacoesComplementares) {
    blocos.push(`Informações complementares: ${informacoesComplementares}`);
  }
  const discriminacao = blocos.join("\n");
  if (discriminacao.length > limiteCaracteres) {
    const origem = informacoesComplementares ? "dos serviços e das informações complementares" : "dos serviços";
    throw new NFSeValidationError(
      `A discriminação consolidada ${origem} ultrapassa ${limiteCaracteres} caracteres. Reduza o texto complementar, as descrições dos serviços na OS ou a quantidade de serviços.`,
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
  // Numa nota agrupada o mesmo serviço pode vir de duas OS; sem o dedupe a
  // referência sairia com "7-7". Ela identifica a tentativa de emissão para a
  // Focus, não o conteúdo da nota — quem guarda o leque completo é
  // nfse_os_servico_vinculo.
  return criarReferenciaPorServicos(osId, [...new Set(itens.map((item) => item.servicoid))]);
}

/**
 * A referência é única por tentativa: a Focus não aceita reenviar uma que já
 * foi usada, nem quando a anterior foi rejeitada. O reenvio precisa gerar a
 * dele, e precisa gerar no mesmo formato — daí este exportado.
 */
export function criarReferenciaPorServicos(osId: number, servicoIds: number[]) {
  const ids = [...servicoIds].sort((a, b) => a - b).join("-");
  return `OS_${osId}_SRVS_${ids}_${Date.now()}`;
}

/**
 * Prepara o reenvio de uma emissão que já aconteceu: pega o payload gravado e
 * devolve o mesmo conteúdo pronto para ir de novo.
 *
 * Só duas coisas mudam, e as duas são obrigatórias:
 *
 * - a referência, porque a Focus não aceita repetir uma já usada, nem depois
 *   de a nota ter sido rejeitada;
 * - a data de emissão, que sai daqui para o serviço recalcular no envio — um
 *   RPS com data de ontem é recusado pela prefeitura.
 *
 * Tirar a data importa mais do que parece: `emitir` põe a nova por último e
 * sobrescreveria a antiga de qualquer jeito, mas `emitirNacional` espalha os
 * dados DEPOIS da data, então a antiga é que venceria. Sem esta remoção o
 * reenvio do modelo Nacional sairia com a data da tentativa anterior.
 *
 * `data_competencia`, que só o Nacional tem, fica: é a competência do serviço
 * prestado, não do envio.
 */
export function prepararReenvioNFSe<T extends Record<string, unknown>>(
  payloadAnterior: T,
  referencia: string,
) {
  const dados = { ...payloadAnterior };
  delete dados.data_emissao;
  return { ...dados, referencia };
}

// Um retorno da Focus cabe folgado nisto. O corte existe para o caso de a
// prefeitura devolver um XML inteiro ou uma página de erro do gateway.
const LIMITE_RETORNO_BRUTO = 20_000;

export type NFSeRetornoBruto = {
  requisicao: { metodo: string; url: string };
  http_status: number;
  recebido_em: string;
  corpo: unknown;
};

/**
 * Lê o corpo da resposta da Focus uma única vez e devolve as duas leituras: o
 * JSON que a lógica usa e o registro bruto que vai para o banco.
 *
 * O `.json().catch(() => null)` que existia aqui apagava tudo que não fosse
 * JSON válido — corpo vazio, HTML de gateway — e reduzia o resto à mensagem já
 * tratada. Quando a prefeitura devolve um erro opaco (o L999 de João Pessoa é o
 * caso conhecido), essa perda é justamente o que falta para o suporte.
 *
 * Não há segredo no que fica gravado: o token vai no cabeçalho Authorization,
 * nunca no corpo nem na URL.
 */
async function lerRespostaFocus(
  res: Response,
  requisicao: { metodo: string; url: string },
): Promise<{ json: any; retornoBruto: NFSeRetornoBruto }> {
  const texto = await res.text().catch(() => "");

  let json: any = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }

  const serializado = json === null ? texto : JSON.stringify(json);
  const corpo = serializado.length > LIMITE_RETORNO_BRUTO
    ? `${serializado.slice(0, LIMITE_RETORNO_BRUTO)}…[truncado]`
    : json ?? texto;

  return {
    json,
    retornoBruto: {
      requisicao,
      http_status: res.status,
      recebido_em: new Date().toISOString(),
      corpo,
    },
  };
}

export class NFSeService {
  private apiUrl: string;
  private token: string;
  private ambiente: "PRODUCAO" | "HOMOLOGACAO" = "HOMOLOGACAO";
  private timezoneIana = "America/Fortaleza";

  constructor() {
    this.token = "";
    this.apiUrl = "";
  }

  /**
   * Configura o ambiente (Homologação ou Produção) baseado na coluna ambiente da tabela empresa.
   * Chamado antes de qualquer emissão ou consulta.
   */
  configurarAmbiente(
    ambiente: "PRODUCAO" | "HOMOLOGACAO" | string,
    tokenConfigurado?: string | null,
    timezoneIana?: string | null,
  ) {
    this.ambiente = ambiente === "PRODUCAO" ? "PRODUCAO" : "HOMOLOGACAO";
    if (timezoneIana?.trim()) this.timezoneIana = timezoneIana.trim();
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
    const dataEmissao = formatDateTimeForFocus(new Date(Date.now() - 5 * 60 * 1000), this.timezoneIana);

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

    const { json, retornoBruto } = await lerRespostaFocus(res, { metodo: "POST", url });

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
        retornoBruto,
      };
    }

    return {
      ok: true,
      status: json?.status || "processando_autorizacao",
      referencia: json?.ref,
      payload,
      retornoBruto,
    };
  }

  async emitirNacional(params: NFSeNacionalEmitirParams) {
    this.assertToken();
    const { referencia, ...dados } = params;
    // O mapeador já converte; aqui vale para o reenvio, que repete o payload
    // gravado — inclusive o de notas anteriores à conversão. Idempotente.
    if (dados.descricao_servico !== undefined) {
      dados.descricao_servico = textoParaDpsNacional(dados.descricao_servico, "manter");
    }
    if (dados.informacoes_complementares !== undefined) {
      dados.informacoes_complementares = textoParaDpsNacional(dados.informacoes_complementares, "separador") || undefined;
    }
    const payload = { data_emissao: formatDateTimeForFocus(new Date(), this.timezoneIana, true), ...dados };
    const url = `${this.apiUrl}/v2/nfsen?ref=${encodeURIComponent(referencia)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: this.getAuthHeader() },
      body: JSON.stringify(payload),
    });
    const { json, retornoBruto } = await lerRespostaFocus(res, { metodo: "POST", url });
    if (!res.ok) {
      const erros = json?.erros || (json ? [json] : []);
      return { ok: false, message: json?.mensagem || json?.codigo || `Erro ${res.status} ao emitir NFS-e Nacional`, erros, payload, retornoBruto };
    }
    return { ok: true, status: json?.status || "processando_autorizacao", referencia: json?.ref || referencia, payload, retornoBruto };
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

    const { json, retornoBruto } = await lerRespostaFocus(res, { metodo: "GET", url });

    if (!res.ok) {
      return {
        ok: false,
        message: json?.mensagem || "Erro ao consultar NFS-e",
        erros: json?.erros || [json],
        retornoBruto,
      };
    }

    const urls = extractNfseUrls(json, this.apiUrl);

    return {
      ok: true,
      retornoBruto,
      status: json?.status,
      numero: json?.numero,
      codigo_verificacao: json?.codigo_verificacao,
      url_consulta: urls.consultationUrl,
      url_pdf: urls.pdfUrl,
      url_xml: urls.xmlUrl,
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

    const { json, retornoBruto } = await lerRespostaFocus(res, { metodo: "DELETE", url });

    if (!res.ok) {
      return {
        ok: false,
        message: json?.mensagem || "Erro ao cancelar NFS-e",
        erros: json?.erros || [json],
        retornoBruto,
      };
    }

    return {
      ok: true,
      status: json?.status,
      retornoBruto,
    };
  }

  async configurarEmpresa(empresa: any, certificadoBase64?: string, senhaCertificado?: string) {
    this.assertToken();

    const cnpj = normalizeCnpj(empresa?.cnpj);
    const inscricaoMunicipal = somenteDigitos(empresa?.inscricaomunicipal);
    const codigoMunicipio = somenteDigitos(empresa?.codigomunicipio);
    const cep = somenteDigitos(empresa?.cep);
    const camposObrigatorios = [
      isValidCnpj(cnpj) ? null : "CNPJ numérico ou alfanumérico válido",
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
    exigirCodigosFiscais({ modelo: "MUNICIPAL_JOAO_PESSOA", exigeRtc: false }, codigosFiscais);
    const cliente = os.cliente;
    const documento = documentoTomador(cliente);
    const informacoesComplementares = validarInformacoesComplementares(codigosFiscais.informacoes_complementares);
    const discriminacao = montarDiscriminacaoServicos(os.id, itensServico, informacoesComplementares);

    return {
      referencia: criarReferencia(os.id, itensServico),
      natureza_operacao: codigosFiscais.natureza_operacao as 1 | 2 | 3 | 4 | 5 | 6,
      optante_simples_nacional: empresa.regimetributario === "1",
      regime_especial_tributacao: empresa.regimetributario === "1" ? 6 : undefined,
      prestador: {
        cnpj: normalizeCnpj(empresa.cnpj),
        inscricao_municipal: somenteDigitos(empresa.inscricaomunicipal),
        codigo_municipio: somenteDigitos(empresa.codigomunicipio),
      },
      tomador: {
        cpf: documento.tipo === "CPF" ? documento.valor : undefined,
        cnpj: documento.tipo === "CNPJ" ? documento.valor : undefined,
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
    exigirCodigosFiscais({ modelo: "MUNICIPAL_CABEDELO", exigeRtc: false }, codigosFiscais);
    const cliente = os.cliente;
    const documento = documentoTomador(cliente);
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
        cnpj: normalizeCnpj(empresa.cnpj),
        inscricao_municipal: somenteDigitos(empresa.inscricaomunicipal),
        codigo_municipio: somenteDigitos(empresa.codigomunicipio),
      },
      tomador: {
        cpf: documento.tipo === "CPF" ? documento.valor : undefined,
        cnpj: documento.tipo === "CNPJ" ? documento.valor : undefined,
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

  /**
   * DPS do padrão Nacional (`POST /v2/nfsen`).
   *
   * A data de competência e a política vêm de fora, de quem decidiu o modelo:
   * assim a nota sai com a mesma data que escolheu o emissor. Sem elas, o
   * mapeador resolve sozinho com o dia corrente — caminho dos testes antigos.
   */
  mapearOSParaFocusNacional(
    os: any,
    empresa: any,
    itensServico: NFSeItemEmissao[],
    codigosFiscais: NFSeCodigosFiscais,
    contexto: { politica?: PoliticaNFSe; dataCompetencia?: string } = {},
  ): NFSeNacionalEmitirParams {
    const dataCompetencia = contexto.dataCompetencia
      ?? dataDoDiaNFSe(new Date(), textoObrigatorio(empresa?.timezone_iana));
    const politica = contexto.politica ?? resolverPoliticaNFSe({
      codigoMunicipio: empresa?.codigomunicipio,
      regimeTributario: empresa?.regimetributario,
      dataCompetencia,
      itensListaServico: [codigosFiscais.item_lista_servico],
    });
    if (politica?.modelo !== "NACIONAL") {
      throw new NFSeValidationError("Esta operação não usa o padrão Nacional da NFS-e.");
    }

    exigirDadosObrigatoriosNFSe(os, empresa, itensServico, "NACIONAL");
    exigirCodigosFiscais(politica, codigosFiscais);
    const declaracaoSimples = opcaoSimplesNacionalDoPrestador(
      empresa.regimetributario,
      codigosFiscais.regime_apuracao_simples_nacional,
    );
    const cliente = os.cliente;
    const documento = documentoTomador(cliente);
    // descricao_servico (xDescServ) do DPS Nacional aceita no máximo 1.000 caracteres.
    const discriminacao = textoParaDpsNacional(
      montarDiscriminacaoServicos(os.id, itensServico, undefined, 1000),
      "manter",
    );
    // Sem quebra de linha e só Latin-1: é o que o xInfComp aceita. O limite é
    // conferido depois da conversão, que pode alongar o texto ("…" → "...").
    const informacoesComplementares = textoParaDpsNacional(
      validarInformacoesComplementares(codigosFiscais.informacoes_complementares),
      "separador",
    ) || undefined;
    if (discriminacao.length > 1000) {
      throw new NFSeValidationError("A discriminação dos serviços ultrapassa 1000 caracteres no padrão Nacional. Reduza as descrições dos serviços na OS.");
    }
    if ((informacoesComplementares?.length ?? 0) > 2000) {
      throw new NFSeValidationError("As informações complementares devem possuir no máximo 2.000 caracteres.");
    }
    const levaGrupoRtc = politica.exigeRtc || informouGrupoRtc(codigosFiscais);
    const textoOpcional = (value: unknown) => textoObrigatorio(value) || undefined;
    return {
      referencia: criarReferencia(os.id, itensServico),
      data_competencia: dataCompetencia,
      codigo_municipio_emissora: Number(somenteDigitos(empresa.codigomunicipio)),
      cnpj_prestador: normalizeCnpj(empresa.cnpj),
      inscricao_municipal_prestador: somenteDigitos(empresa.inscricaomunicipal) || undefined,
      ...declaracaoSimples,
      // regEspTrib é obrigatório na DPS; 0 é "Nenhum" na tabela nacional. A
      // empresa que tem regime especial cadastra no padrão Nacional.
      regime_especial_tributacao: codigosFiscais.regime_especial_tributacao ?? 0,
      cpf_tomador: documento.tipo === "CPF" ? documento.valor : undefined,
      cnpj_tomador: documento.tipo === "CNPJ" ? documento.valor : undefined,
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
      // cTribMun tem 3 posições no leiaute nacional. O `codigoservicomunicipal`
      // do cadastro de serviço é do emissor municipal antigo e não serve aqui.
      codigo_tributacao_municipal_iss: textoOpcional(codigosFiscais.codigo_tributacao_municipal_iss),
      codigo_nbs: codigosFiscais.codigo_nbs
        ? String(codigosFiscais.codigo_nbs).replace(/\D/g, "")
        : undefined,
      descricao_servico: discriminacao,
      informacoes_complementares: informacoesComplementares,
      valor_servico: valorTotalServicos(itensServico),
      tributacao_iss: codigosFiscais.tributacao_iss as 1 | 2 | 3 | 4,
      tipo_retencao_iss: codigosFiscais.tipo_retencao_iss as 1 | 2 | 3,
      // pAliq: município conveniado ao Sistema Nacional tem a alíquota
      // parametrizada e a fornece sozinho. Só vai quando alguém preencheu.
      percentual_aliquota_relativa_municipio: codigosFiscais.aliquota_iss,
      indicador_total_tributacao: "0",
      ...(levaGrupoRtc
        ? {
            finalidade_emissao: codigosFiscais.finalidade_emissao as 0,
            consumidor_final: codigosFiscais.consumidor_final as 0 | 1,
            indicador_destinatario: codigosFiscais.indicador_destinatario as 0 | 1,
            codigo_indicador_operacao: textoOpcional(codigosFiscais.codigo_indicador_operacao),
            ibs_cbs_situacao_tributaria: textoOpcional(codigosFiscais.ibs_cbs_situacao_tributaria),
            ibs_cbs_classificacao_tributaria: textoOpcional(codigosFiscais.ibs_cbs_classificacao_tributaria),
          }
        : {}),
    };
  }
}

function formatDateTimeForFocus(date: Date, timezoneIana: string, includeOffset = false) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezoneIana,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: includeOffset ? "longOffset" : undefined,
  }).formatToParts(date);

  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const local = `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}T${byType.get("hour")}:${byType.get("minute")}:${byType.get("second")}`;
  if (!includeOffset) return local;
  const offset = String(byType.get("timeZoneName") ?? "GMT")
    .replace(/^GMT(?:UTC)?/, "")
    .replace(/\u2212/g, "-") || "+00:00";
  return `${local}${offset}`;
}

