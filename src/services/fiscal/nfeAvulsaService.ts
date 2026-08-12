import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  buildNFePreviewXml,
  type NFePagamentoOptions,
  type NFeTransporteOptions,
} from "@/lib/nfe/buildNFe";
import { carregarCertificadoA1 } from "@/lib/nfe/certificado";
import { chaveAcessoValida } from "@/lib/nfe/chaveAcesso";
import { NFE_HOMOLOGACAO_DESTINATARIO_NOME } from "@/lib/nfe/constants";
import { normalizarIndIEDest } from "@/lib/nfe/indIEDest";
import { calcularTotaisNFe } from "@/lib/nfe/fiscal";
import { MODELO_NFE, MODELO_NFCE, modeloParaDb, rotuloModelo } from "@/lib/nfe/modeloDocumento";
import { validarNfce } from "@/lib/nfe/nfce/validator";
import type {
  CRT,
  ClassificacaoTributariaRtc,
  EmpresaRow,
  ModeloDocumentoFiscal,
  NFeDestinatario,
  NFeItem,
} from "@/lib/nfe/types";
import { getNFeFiscalFieldRules, NFE_FISCAL_RULE_VERSION, validateNFeItemTax } from "@/lib/nfe/taxRules";
import { resolverNomeMunicipioIbge } from "@/lib/ibge/municipio";
import { isCfopCompatibleWithOperation } from "@/lib/nfe/cfopOperation";
import { preverProximoNumero } from "@/services/fiscal/nfeNumeracaoService";
import {
  isValidCnpj,
  isValidCpf,
  normalizeFiscalRecipient,
} from "@/lib/nfe/recipientNormalization";

type NFeConfigRow = {
  id: number;
  empresaid: number;
  modelo: string;
  serie: number;
  ultimo_numero: number;
  ambiente: "HOMOLOGACAO" | "PRODUCAO";
};

export type NFeAvulsaItemInput = {
  sourceItemId?: string | null;
  produtoId?: number | null;
  codigo?: string | null;
  descricao: string;
  ncm: string;
  cfop: string;
  unidade: string;
  quantidade: string | number;
  valorUnitario: string | number;
  valorFrete?: string | number | null;
  /**
   * Desconto incondicional do item, em reais. Nas emissões a partir de OS e
   * venda vem pré-preenchido com o desconto do item somado ao rateio do
   * desconto geral, mas continua editável até a autorização.
   */
  valorDesconto?: string | number | null;
  orig?: string | number | null;
  csosn?: string | null;
  cst?: string | null;
  cstPis?: string | null;
  aliquotaPis?: string | number | null;
  cstCofins?: string | null;
  aliquotaCofins?: string | number | null;
  aliquotaIcms?: string | number | null;
  cest?: string | null;
  modoPis?: "PERCENTUAL" | "QUANTIDADE" | "NAO_TRIBUTADO" | null;
  basePis?: string | number | null;
  quantidadePis?: string | number | null;
  aliquotaPorUnidadePis?: string | number | null;
  valorPis?: string | number | null;
  modoCofins?: "PERCENTUAL" | "QUANTIDADE" | "NAO_TRIBUTADO" | null;
  baseCofins?: string | number | null;
  quantidadeCofins?: string | number | null;
  aliquotaPorUnidadeCofins?: string | number | null;
  valorCofins?: string | number | null;
  rtcHabilitado?: boolean;
  cstIbsCbs?: string | null;
  cClassTrib?: string | null;
  baseRtc?: string | number | null;
  aliquotaIbsUf?: string | number | null;
  valorIbsUf?: string | number | null;
  aliquotaIbsMunicipio?: string | number | null;
  valorIbsMunicipio?: string | number | null;
  aliquotaCbs?: string | number | null;
  valorCbs?: string | number | null;
  /**
   * De onde veio cada campo fiscal quando a tela montou o item: 'PRODUTO',
   * 'PADRAO' (perfil de Configurações), 'REGRA' ou 'VAZIO'. Não influencia
   * cálculo nem XML — só é guardado no snapshot para auditoria.
   */
  procedenciaFiscal?: Record<string, string> | null;
  /** DIFAL (ICMSUFDest) confirmado pelo usuário; sobrepõe os padrões do motor. */
  aliquotaInternaDestino?: string | number | null;
  aliquotaInterestadual?: string | number | null;
  aliquotaFcpDestino?: string | number | null;
  percentualPartilhaDestino?: string | number | null;
  baseCalculoFcpDestino?: string | number | null;
  percentualDevolucao?: string | number | null;
  valorIpiDevolvido?: string | number | null;
  dfeReferenciado?: {
    chaveAcesso: string;
    nItem?: number | null;
  } | null;
  informacoesAdicionaisProduto?: string | null;
};

export type NFeAvulsaDraftInput = {
  nfeId?: number | null;
  currentStep?: number;
  /**
   * Modelo do documento. Omitido = 55 (NF-e), preservando todos os chamadores
   * anteriores à NFC-e.
   */
  modelo?: ModeloDocumentoFiscal;
  origem?: {
    tipo: "AVULSA" | "OS" | "VENDA" | "ENTRADA" | "SAIDA";
    ordemServicoId?: number | null;
    vendaId?: number | null;
    entradaId?: number | null;
    saidaId?: number | null;
    clienteId?: number | null;
    fornecedorId?: number | null;
  } | null;
  operacao: {
    tipoOperacao: "SAIDA" | "ENTRADA";
    naturezaOperacao: string;
    finalidade: "NORMAL" | "COMPLEMENTAR" | "AJUSTE" | "DEVOLUCAO";
    consumidorFinal: boolean;
    indicadorPresenca: string;
    observacaoInterna?: string | null;
    observacoesFiscais?: string | null;
  };
  pagamento?: {
    meio?: string | null;
    tipoIntegracao?: "1" | "2" | string | null;
    cnpjCredenciadora?: string | null;
    bandeira?: string | null;
    autorizacao?: string | null;
    descricao?: string | null;
  } | null;
  /**
   * Desconto geral digitado na tela. Não vai para o XML: já chega rateado no
   * `valorDesconto` de cada item, porque o leiaute 4.00 não tem desconto de
   * nota. Guardamos só para o rascunho reabrir com o mesmo número.
   */
  descontoGeral?: string | number | null;
  pagamentos?: Array<{
    meio?: string | null;
    valor?: string | number | null;
    tipoIntegracao?: "1" | "2" | string | null;
    cnpjCredenciadora?: string | null;
    bandeira?: string | null;
    autorizacao?: string | null;
    descricao?: string | null;
  }> | null;
  transporte?: {
    modFrete?: "0" | "1" | "2" | "3" | "4" | "9" | string | null;
    transportadora?: {
      documento?: string | null;
      nome?: string | null;
      inscricaoEstadual?: string | null;
      endereco?: string | null;
      municipio?: string | null;
      uf?: string | null;
    } | null;
    veiculo?: {
      placa?: string | null;
      uf?: string | null;
      rntc?: string | null;
    } | null;
    volume?: {
      quantidade?: string | number | null;
      especie?: string | null;
      marca?: string | null;
      numeracao?: string | null;
      pesoLiquido?: string | number | null;
      pesoBruto?: string | number | null;
    } | null;
  } | null;
  destinatario: {
    clienteId: number | null;
    tipoPessoa?: "FISICA" | "JURIDICA" | "ESTRANGEIRO";
    cpfCnpj?: string | null;
    nomeRazaoSocial?: string | null;
    indicadorIe?: string | null;
    inscricaoEstadual?: string | null;
    inscricaoMunicipal?: string | null;
    email?: string | null;
    telefone?: string | null;
    endereco?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    estado?: string | null;
    cep?: string | null;
    codigoMunicipio?: string | null;
    codigoPais?: string | null;
    nomePais?: string | null;
  };
  itens: NFeAvulsaItemInput[];
  documentosReferenciados?: Array<{ chaveAcesso: string }> | null;
};

type ValidationError = {
  step: string;
  field?: string;
  itemIndex?: number;
  message: string;
};

const unidadesPermitidas = new Set(["UN", "JGO", "KIT", "PAR", "CX", "PCT"]);

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function toDecimalNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  const sanitized = raw.replace(/[^\d,.-]/g, "");
  const normalized = sanitized.includes(",")
    ? sanitized.replace(/\./g, "").replace(",", ".")
    : sanitized;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toOptionalDecimal(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return toDecimalNumber(value);
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function calculateValue(base: number, aliquota: number, informed: unknown) {
  const explicit = toOptionalDecimal(informed);
  return explicit ?? Number(((base * aliquota) / 100).toFixed(2));
}

function mapInputToTaxItem(item: NFeAvulsaItemInput, index: number): NFeItem {
  const quantidade = toDecimalNumber(item.quantidade);
  const valorUnitario = toDecimalNumber(item.valorUnitario);
  const valorTotal = Number((quantidade * valorUnitario).toFixed(2));
  // O desconto nunca pode superar o próprio item: um vDesc maior que vProd
  // derruba a nota na SEFAZ e ainda geraria base de cálculo negativa.
  const valorDesconto = Math.min(Math.max(0, toDecimalNumber(item.valorDesconto)), valorTotal);
  const valorLiquido = Number((valorTotal - valorDesconto).toFixed(2));
  const buildContribution = (type: "pis" | "cofins") => {
    const isPis = type === "pis";
    const modo = (isPis ? item.modoPis : item.modoCofins) ?? undefined;
    const aliquota = toOptionalDecimal(isPis ? item.aliquotaPis : item.aliquotaCofins);
    const base = toOptionalDecimal(isPis ? item.basePis : item.baseCofins);
    const qtd = toOptionalDecimal(isPis ? item.quantidadePis : item.quantidadeCofins);
    const unitRate = toOptionalDecimal(isPis ? item.aliquotaPorUnidadePis : item.aliquotaPorUnidadeCofins);
    const explicitValue = toOptionalDecimal(isPis ? item.valorPis : item.valorCofins);
    if (!modo) return undefined;
    return {
      cst: cleanText(isPis ? item.cstPis : item.cstCofins),
      modo,
      ...(base !== null ? { base } : {}),
      ...(aliquota !== null ? { aliquota } : {}),
      ...(qtd !== null ? { quantidade: qtd } : {}),
      ...(unitRate !== null ? { aliquotaPorUnidade: unitRate } : {}),
      ...(explicitValue !== null ? { valor: explicitValue } : {}),
    };
  };
  const rtcEnabled = Boolean(item.rtcHabilitado);
  const baseRtc = toDecimalNumber(item.baseRtc || valorLiquido);
  const pIbsUf = toDecimalNumber(item.aliquotaIbsUf);
  const pIbsMun = toDecimalNumber(item.aliquotaIbsMunicipio);
  const pCbs = toDecimalNumber(item.aliquotaCbs);
  const vIbsUf = calculateValue(baseRtc, pIbsUf, item.valorIbsUf);
  const vIbsMun = calculateValue(baseRtc, pIbsMun, item.valorIbsMunicipio);
  return {
    numeroItem: index + 1,
    // cProd usa o id do produto: a referencia e texto livre (traco, espaco, varios
    // codigos) e nao permite reencontrar o produto ao ler a nota de volta.
    codigoProduto: item.produtoId != null
      ? String(item.produtoId)
      : cleanText(item.codigo) || String(index + 1),
    // DIFAL: repassa apenas o que veio preenchido. Campo vazio deixa o motor
    // resolver com os padroes.
    aliquotaInternaDestino: toOptionalDecimal(item.aliquotaInternaDestino) ?? undefined,
    aliquotaInterestadual: toOptionalDecimal(item.aliquotaInterestadual) ?? undefined,
    aliquotaFcpDestino: toOptionalDecimal(item.aliquotaFcpDestino) ?? undefined,
    percentualPartilhaDestino: toOptionalDecimal(item.percentualPartilhaDestino) ?? undefined,
    baseCalculoFcpDestino: toOptionalDecimal(item.baseCalculoFcpDestino) ?? undefined,
    percentualDevolucao: toOptionalDecimal(item.percentualDevolucao) ?? undefined,
    valorIpiDevolvido: toOptionalDecimal(item.valorIpiDevolvido) ?? undefined,
    dfeReferenciado: item.dfeReferenciado
      ? {
          chaveAcesso: onlyDigits(item.dfeReferenciado.chaveAcesso),
          nItem: item.dfeReferenciado.nItem ?? null,
        }
      : undefined,
    informacoesAdicionaisProduto: cleanText(item.informacoesAdicionaisProduto) || undefined,
    descricao: cleanText(item.descricao),
    ncm: onlyDigits(item.ncm),
    cfop: onlyDigits(item.cfop),
    unidade: cleanText(item.unidade) || "UN",
    quantidade,
    valorUnitario,
    valorTotal,
    valorDesconto,
    valorFrete: Math.max(0, toDecimalNumber(item.valorFrete)),
    orig: cleanText(item.orig),
    cest: onlyDigits(item.cest) || null,
    csosn: cleanText(item.csosn) || null,
    cst: cleanText(item.cst) || null,
    cstIcms: cleanText(item.cst) || null,
    aliquotaIcms: toOptionalDecimal(item.aliquotaIcms) ?? undefined,
    baseCalculoIcms: toOptionalDecimal(item.aliquotaIcms) === null ? undefined : valorLiquido,
    cstPis: cleanText(item.cstPis) || null,
    aliquotaPis: toOptionalDecimal(item.aliquotaPis) ?? undefined,
    cstCofins: cleanText(item.cstCofins) || null,
    aliquotaCofins: toOptionalDecimal(item.aliquotaCofins) ?? undefined,
    pis: buildContribution("pis"),
    cofins: buildContribution("cofins"),
    ...(rtcEnabled ? {
      rtc: {
        cstIbsCbs: cleanText(item.cstIbsCbs),
        cClassTrib: cleanText(item.cClassTrib),
        baseCalculo: baseRtc,
        ibsUf: { aliquota: pIbsUf, valor: vIbsUf },
        ibsMunicipio: { aliquota: pIbsMun, valor: vIbsMun },
        valorIbs: Number((vIbsUf + vIbsMun).toFixed(2)),
        cbs: { aliquota: pCbs, valor: calculateValue(baseRtc, pCbs, item.valorCbs) },
      },
    } : {}),
  };
}

/**
 * Destinatário no formato do XML.
 *
 * Devolve `undefined` quando é NFC-e sem consumidor identificado — o grupo
 * <dest> simplesmente não existe nesse caso, e o motor sabe lidar com isso.
 */
function getDestinatarioSnapshot(
  input: NFeAvulsaDraftInput,
  empresa: EmpresaRow,
): NFeDestinatario | undefined {
  const dest = normalizeFiscalRecipient(input.destinatario);
  const documento = onlyDigits(dest.cpfCnpj);

  if ((input.modelo ?? MODELO_NFE) === MODELO_NFCE) {
    if (!documento) return undefined;

    // Consumidor identificado na NFC-e: só o documento e o nome, quando houver.
    // Endereço é opcional e não é cobrado no balcão.
    const pessoaJuridica = documento.length === 14;
    return {
      cnpj: pessoaJuridica ? documento : undefined,
      cpf: pessoaJuridica ? undefined : documento,
      razaoSocial: cleanText(dest.nomeRazaoSocial) || "CONSUMIDOR",
      indIEDest: "9",
      endereco: {
        logradouro: cleanText(dest.endereco) || "",
        numero: cleanText(dest.numero) || "",
        bairro: cleanText(dest.bairro) || "",
        codigoMunicipio: cleanText(dest.codigoMunicipio) || "",
        nomeMunicipio: cleanText(dest.cidade) || "",
        uf: cleanText(dest.estado) || cleanText(empresa.uf) || "",
        cep: onlyDigits(dest.cep) || "",
        codigoPais: "1058",
        nomePais: "BRASIL",
        telefone: onlyDigits(dest.telefone) || undefined,
      },
    };
  }
  const tipoPessoa =
    dest.tipoPessoa ??
    (documento.length === 14 ? "JURIDICA" : documento.length === 11 ? "FISICA" : "ESTRANGEIRO");
  const isCnpj = tipoPessoa === "JURIDICA" || documento.length === 14;
  const isCpf = tipoPessoa === "FISICA" || documento.length === 11;
  const ie = onlyDigits(dest.inscricaoEstadual);
  // Sem dedução pela existência da IE: `validateDraft` já exige 1, 2 ou 9, e
  // deduzir aqui reintroduziria o <indIEDest>1</indIEDest> que gera a rejeição
  // 306 para inscrição inativa. O `?? ""` só mantém o tipo; a validação barra.
  const indicadorIe = cleanText(dest.indicadorIe);

  return {
    cnpj: isCnpj && documento ? documento : undefined,
    cpf: isCpf && !isCnpj && documento ? documento : undefined,
    razaoSocial:
      empresa.ambiente === "PRODUCAO"
        ? cleanText(dest.nomeRazaoSocial)
        : NFE_HOMOLOGACAO_DESTINATARIO_NOME,
    indIEDest: normalizarIndIEDest(indicadorIe) as NFeDestinatario["indIEDest"],
    inscricaoEstadual: indicadorIe === "1" ? ie || undefined : undefined,
    endereco: {
      logradouro: cleanText(dest.endereco) || "NAO INFORMADO",
      numero: cleanText(dest.numero) || "S/N",
      complemento: cleanText(dest.complemento) || undefined,
      bairro: cleanText(dest.bairro) || "CENTRO",
      codigoMunicipio: cleanText(dest.codigoMunicipio) || empresa.codigomunicipio || "0000000",
      nomeMunicipio: cleanText(dest.cidade) || "NAO INFORMADO",
      uf: cleanText(dest.estado) || empresa.uf || "PB",
      cep: onlyDigits(dest.cep) || onlyDigits(empresa.cep) || "00000000",
      codigoPais: cleanText(dest.codigoPais) || "1058",
      nomePais: cleanText(dest.nomePais) || "BRASIL",
      telefone: onlyDigits(dest.telefone) || undefined,
    },
  };
}

function finalidadeToFinNFe(finalidade: NFeAvulsaDraftInput["operacao"]["finalidade"]) {
  if (finalidade === "COMPLEMENTAR") return 2 as const;
  if (finalidade === "AJUSTE") return 3 as const;
  if (finalidade === "DEVOLUCAO") return 4 as const;
  return 1 as const;
}

function getPagamentoFiscal(input: NFeAvulsaDraftInput): NFePagamentoOptions {
  const finNFe = finalidadeToFinNFe(input.operacao.finalidade);
  const rawMeio = onlyDigits(input.pagamento?.meio);
  const meioNormalizado = rawMeio ? rawMeio.padStart(2, "0").slice(0, 2) : "01";
  const meio = finNFe === 3 || finNFe === 4 ? "90" : meioNormalizado;

  return {
    tPag: meio,
    tpIntegra: input.pagamento?.tipoIntegracao === "1" ? "1" : "2",
    cnpjCredenciadora: onlyDigits(input.pagamento?.cnpjCredenciadora),
    bandeira: onlyDigits(input.pagamento?.bandeira),
    autorizacao: cleanText(input.pagamento?.autorizacao),
    xPag: cleanText(input.pagamento?.descricao),
  };
}

function getPagamentosFiscais(input: NFeAvulsaDraftInput): NFePagamentoOptions[] {
  const finNFe = finalidadeToFinNFe(input.operacao.finalidade);
  if (finNFe === 3 || finNFe === 4) return [{ tPag: "90", valor: 0, tpIntegra: "2" }];
  if (!input.pagamentos?.length) return [getPagamentoFiscal(input)];

  return input.pagamentos.map((pagamento) => {
    const tPag = onlyDigits(pagamento.meio).padStart(2, "0").slice(0, 2);
    return {
    tPag,
    // "Sem pagamento" é sempre vPag 0: mandar o total da nota num detPag 90
    // contradiz o próprio código e a SEFAZ rejeita.
    valor: tPag === "90" ? 0 : toDecimalNumber(pagamento.valor),
    tpIntegra: pagamento.tipoIntegracao === "1" ? "1" : "2",
    cnpjCredenciadora: onlyDigits(pagamento.cnpjCredenciadora),
    bandeira: onlyDigits(pagamento.bandeira),
    autorizacao: cleanText(pagamento.autorizacao),
    xPag: cleanText(pagamento.descricao),
    };
  });
}

function getPagamentoDadosAvulsos(input: NFeAvulsaDraftInput) {
  const pagamento = getPagamentoFiscal(input);

  return {
    meio: pagamento.tPag,
    tipoIntegracao: pagamento.tpIntegra,
    cnpjCredenciadora: pagamento.cnpjCredenciadora,
    bandeira: pagamento.bandeira,
    autorizacao: pagamento.autorizacao,
    descricao: pagamento.xPag,
  };
}

function getPagamentosDadosAvulsos(input: NFeAvulsaDraftInput) {
  return getPagamentosFiscais(input).map((pagamento) => ({
    meio: pagamento.tPag,
    valor: pagamento.valor ?? null,
    tipoIntegracao: pagamento.tpIntegra,
    cnpjCredenciadora: pagamento.cnpjCredenciadora,
    bandeira: pagamento.bandeira,
    autorizacao: pagamento.autorizacao,
    descricao: pagamento.xPag,
  }));
}

function getTransporteFiscal(input: NFeAvulsaDraftInput): NFeTransporteOptions {
  const rawModFrete = cleanText(input.transporte?.modFrete || "9");
  const modFrete = ["0", "1", "2", "3", "4", "9"].includes(rawModFrete) ? rawModFrete : "9";

  if (modFrete === "9") {
    return { modFrete: "9" };
  }

  return {
    modFrete,
    transportadora: {
      documento: onlyDigits(input.transporte?.transportadora?.documento),
      nome: cleanText(input.transporte?.transportadora?.nome),
      inscricaoEstadual: onlyDigits(input.transporte?.transportadora?.inscricaoEstadual),
      endereco: cleanText(input.transporte?.transportadora?.endereco),
      municipio: cleanText(input.transporte?.transportadora?.municipio),
      uf: cleanText(input.transporte?.transportadora?.uf).toUpperCase().slice(0, 2),
    },
    veiculo: {
      placa: cleanText(input.transporte?.veiculo?.placa).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7),
      uf: cleanText(input.transporte?.veiculo?.uf).toUpperCase().slice(0, 2),
      rntc: cleanText(input.transporte?.veiculo?.rntc),
    },
    volume: {
      quantidade: cleanText(input.transporte?.volume?.quantidade),
      especie: cleanText(input.transporte?.volume?.especie),
      marca: cleanText(input.transporte?.volume?.marca),
      numeracao: cleanText(input.transporte?.volume?.numeracao),
      pesoLiquido: cleanText(input.transporte?.volume?.pesoLiquido),
      pesoBruto: cleanText(input.transporte?.volume?.pesoBruto),
    },
  };
}

function getTransporteDadosAvulsos(input: NFeAvulsaDraftInput) {
  return getTransporteFiscal(input);
}

function validarEmpresa(
  empresa: EmpresaRow | null,
  config: NFeConfigRow | null,
  modelo: ModeloDocumentoFiscal = MODELO_NFE,
) {
  const erros: string[] = [];
  if (!empresa) return ["Empresa ativa não encontrada."];
  if (onlyDigits(empresa.cnpj).length !== 14) erros.push("CNPJ da empresa inválido ou ausente.");
  if (!empresa.razaosocial) erros.push("Razão social da empresa ausente.");
  if (!empresa.inscricaoestadual) erros.push("Inscrição estadual da empresa ausente.");
  if (!empresa.endereco) erros.push("Endereço da empresa ausente.");
  if (!empresa.numero) erros.push("Número do endereço da empresa ausente.");
  if (!empresa.bairro) erros.push("Bairro da empresa ausente.");
  if (!empresa.codigomunicipio) erros.push("Código IBGE do município da empresa ausente.");
  if (!empresa.uf) erros.push("UF da empresa ausente.");
  if (onlyDigits(empresa.cep).length !== 8) erros.push("CEP da empresa inválido ou ausente.");
  if (!empresa.regimetributario) erros.push("CRT/regime tributário da empresa ausente.");
  if (!empresa.ambiente) erros.push("Ambiente fiscal da empresa ausente.");
  const rotulo = rotuloModelo(modelo);
  if (!config) erros.push(`Configuração de ${rotulo} não encontrada.`);
  if (!config?.serie) erros.push(`Série de ${rotulo} não configurada.`);
  if (config && config.modelo !== modeloParaDb(modelo)) {
    erros.push(`Configuração fiscal carregada é do modelo ${config.modelo}, e não de ${rotulo}.`);
  }
  if (!empresa.certificadocaminho) erros.push("Certificado A1 não configurado.");
  if (!empresa.certificadosenha) erros.push("Senha do certificado A1 não configurada.");
  return erros;
}

export function validarDraftAvulso(input: NFeAvulsaDraftInput) {
  const errors: ValidationError[] = [];

  if (!cleanText(input.operacao?.naturezaOperacao)) {
    errors.push({
      step: "operation",
      field: "naturezaOperacao",
      message: "Natureza da operação é obrigatória.",
    });
  }

  // NF-e de devolução (finNFe=4) sem documento referenciado é rejeição 321.
  // A referência pode estar no cabeçalho (NFref) ou, no leiaute RTC, em cada
  // item (DFeReferenciado). O motor de saída usa a segunda forma.
  const referencias = input.documentosReferenciados ?? [];
  const referenciasDosItens = input.itens
    .map((item) => item.dfeReferenciado?.chaveAcesso)
    .filter(Boolean);
  const exigeReferencia = finalidadeToFinNFe(input.operacao?.finalidade) === 4;
  if (exigeReferencia && referencias.length === 0 && referenciasDosItens.length === 0) {
    errors.push({
      step: "operation",
      field: "documentosReferenciados",
      message:
        "Informe a chave de acesso da NF-e que está sendo devolvida. " +
        "Devolução sem documento referenciado é rejeitada pela SEFAZ (rejeição 321).",
    });
  }
  referencias.forEach((referencia, index) => {
    if (!chaveAcessoValida(referencia?.chaveAcesso)) {
      errors.push({
        step: "operation",
        field: `documentosReferenciados.${index}.chaveAcesso`,
        message: "Chave de acesso da NF-e referenciada inválida: confira os 44 dígitos.",
      });
    }
  });
  if (
    new Set(referencias.map((referencia) => onlyDigits(referencia?.chaveAcesso))).size !==
    referencias.length
  ) {
    errors.push({
      step: "operation",
      field: "documentosReferenciados",
      message: "A mesma NF-e foi referenciada mais de uma vez.",
    });
  }

  const modelo = input.modelo ?? MODELO_NFE;
  const destinatario = input.destinatario ?? {};
  const docDestinatario = onlyDigits(destinatario.cpfCnpj);
  const isExterior = destinatario.tipoPessoa === "ESTRANGEIRO";

  if (modelo === MODELO_NFCE) {
    // Consumidor não identificado é o caso normal da NFC-e: nada de nome,
    // endereço ou indicador de IE. O que não pode é documento inválido — e a
    // exigência de CPF/CNPJ por valor é regra estadual, verificada em
    // `validarNfce` com o total já calculado.
    if (docDestinatario) {
      const documentoValido =
        docDestinatario.length === 14 ? isValidCnpj(docDestinatario) : isValidCpf(docDestinatario);
      if (!documentoValido) {
        errors.push({
          step: "recipient",
          field: "cpfCnpj",
          message: "CPF ou CNPJ do consumidor é inválido.",
        });
      }
    }
  } else {
    if (!cleanText(destinatario.nomeRazaoSocial)) {
      errors.push({
        step: "recipient",
        field: "nomeRazaoSocial",
        message: "Nome ou razão social do destinatário é obrigatório.",
      });
    }
    if (
      !isExterior &&
      ((destinatario.tipoPessoa === "FISICA" && !isValidCpf(docDestinatario)) ||
        (destinatario.tipoPessoa !== "FISICA" && !isValidCnpj(docDestinatario)))
    ) {
      errors.push({
        step: "recipient",
        field: "cpfCnpj",
        message: `${destinatario.tipoPessoa === "FISICA" ? "CPF" : "CNPJ"} do destinatário é inválido.`,
      });
    }
    if (!["1", "2", "9"].includes(cleanText(destinatario.indicadorIe))) {
      errors.push({
        step: "recipient",
        field: "indicadorIe",
        message: "Indicador de inscrição estadual do destinatário é inválido.",
      });
    }
    if (
      cleanText(destinatario.indicadorIe) === "1" &&
      !onlyDigits(destinatario.inscricaoEstadual)
    ) {
      errors.push({
        step: "recipient",
        field: "inscricaoEstadual",
        message: "Inscrição estadual é obrigatória para contribuinte ICMS.",
      });
    }
    if (
      cleanText(destinatario.email) &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanText(destinatario.email))
    ) {
      errors.push({
        step: "recipient",
        field: "email",
        message: "E-mail do destinatário é inválido.",
      });
    }
    if (!cleanText(destinatario.endereco)) {
      errors.push({ step: "recipient", field: "endereco", message: "Endereço do destinatário é obrigatório." });
    }
    if (!cleanText(destinatario.bairro)) {
      errors.push({ step: "recipient", field: "bairro", message: "Bairro do destinatário é obrigatório." });
    }
    if (!cleanText(destinatario.cidade)) {
      errors.push({ step: "recipient", field: "cidade", message: "Cidade do destinatário é obrigatória." });
    }
    if (!cleanText(destinatario.estado)) {
      errors.push({ step: "recipient", field: "estado", message: "UF do destinatário é obrigatória." });
    }
    if (!isExterior && onlyDigits(destinatario.cep).length !== 8) {
      errors.push({ step: "recipient", field: "cep", message: "CEP do destinatário deve ter 8 dígitos." });
    }
    if (!isExterior && onlyDigits(destinatario.codigoMunicipio).length !== 7) {
      errors.push({
        step: "recipient",
        field: "codigoMunicipio",
        message: "Código IBGE do município do destinatário deve ter 7 dígitos.",
      });
    }
  }

  if (!Array.isArray(input.itens) || input.itens.length === 0) {
    errors.push({
      step: "products",
      message: "Informe pelo menos um produto.",
    });
  }

  input.itens?.forEach((item, index) => {
    if (!cleanText(item.descricao)) {
      errors.push({ step: "products", itemIndex: index, field: "descricao", message: "Descrição obrigatória." });
    }
    if (onlyDigits(item.ncm).length !== 8) {
      errors.push({ step: "products", itemIndex: index, field: "ncm", message: "NCM deve ter 8 dígitos." });
    }
    if (onlyDigits(item.cfop).length !== 4) {
      errors.push({ step: "products", itemIndex: index, field: "cfop", message: "CFOP deve ter 4 dígitos." });
    }
    if (!unidadesPermitidas.has(cleanText(item.unidade))) {
      errors.push({ step: "products", itemIndex: index, field: "unidade", message: "Unidade inválida." });
    }
    if (toDecimalNumber(item.quantidade) <= 0) {
      errors.push({ step: "products", itemIndex: index, field: "quantidade", message: "Quantidade deve ser maior que zero." });
    }
    if (toDecimalNumber(item.valorUnitario) <= 0) {
      errors.push({ step: "products", itemIndex: index, field: "valorUnitario", message: "Valor unitário deve ser maior que zero." });
    }
    if (toDecimalNumber(item.valorFrete) < 0) {
      errors.push({ step: "products", itemIndex: index, field: "valorFrete", message: "Frete não pode ser negativo." });
    }
    const descontoItem = toDecimalNumber(item.valorDesconto);
    if (descontoItem < 0) {
      errors.push({ step: "products", itemIndex: index, field: "valorDesconto", message: "Desconto não pode ser negativo." });
    }
    if (
      descontoItem >
      Number((toDecimalNumber(item.quantidade) * toDecimalNumber(item.valorUnitario)).toFixed(2)) + 0.001
    ) {
      errors.push({
        step: "products",
        itemIndex: index,
        field: "valorDesconto",
        message: "Desconto não pode ser maior que o total do item.",
      });
    }
  });

  const pagamentosFiscais = getPagamentosFiscais(input);

  pagamentosFiscais.forEach((pagamentoFiscal, paymentIndex) => {
    // PIX entra junto com cartão desde a NT 2025.001 (RV YA04-10/YA05-10).
    const exigeGrupoCard = ["03", "04", "17"].includes(pagamentoFiscal.tPag);
    if (exigeGrupoCard && pagamentoFiscal.tpIntegra === "1") {
      if (onlyDigits(pagamentoFiscal.cnpjCredenciadora).length !== 14) {
        errors.push({
          step: "payment",
          field: `pagamentos.${paymentIndex}.cnpjCredenciadora`,
          message: "Informe o CNPJ da credenciadora quando o cartão for integrado ao sistema.",
        });
      }
      if (!pagamentoFiscal.autorizacao) {
        errors.push({
          step: "payment",
          field: `pagamentos.${paymentIndex}.autorizacao`,
          message: "Informe o código de autorização quando o cartão for integrado ao sistema.",
        });
      }
    }

    if (pagamentoFiscal.tPag === "99" && !pagamentoFiscal.xPag) {
      errors.push({
        step: "payment",
        field: `pagamentos.${paymentIndex}.descricao`,
        message: "Informe a descrição da forma de pagamento quando o método for \"Outros\".",
      });
    }
  });

  if (input.pagamentos?.length) {
    if (new Set(pagamentosFiscais.map((pagamento) => pagamento.tPag)).size !== pagamentosFiscais.length) {
      errors.push({
        step: "payment",
        field: "pagamentos",
        message: "O mesmo método de pagamento não pode ser informado mais de uma vez.",
      });
    }
    if (
      pagamentosFiscais.length > 1 &&
      pagamentosFiscais.some((pagamento) => toDecimalNumber(pagamento.valor) <= 0)
    ) {
      errors.push({
        step: "payment",
        field: "pagamentos",
        message: "Informe um valor maior que zero para cada método de pagamento.",
      });
    }
    if (pagamentosFiscais.length > 1 && pagamentosFiscais.some((pagamento) => pagamento.tPag === "90")) {
      errors.push({
        step: "payment",
        field: "pagamentos",
        message: "Sem pagamento não pode ser combinado com outros métodos.",
      });
    }
    const totalProdutos = input.itens.reduce(
      (total, item) => total + toDecimalNumber(item.quantidade) * toDecimalNumber(item.valorUnitario),
      0,
    );
    const totalDesconto = input.itens.reduce(
      (total, item) => total + Math.max(0, toDecimalNumber(item.valorDesconto)),
      0,
    );
    const totalFrete = input.itens.reduce(
      (total, item) => total + Math.max(0, toDecimalNumber(item.valorFrete)),
      0,
    );
    const totalNota = totalProdutos - totalDesconto + totalFrete;
    const totalPagamentos = pagamentosFiscais.reduce(
      (total, pagamento) => total + toDecimalNumber(pagamento.valor),
      0,
    );
    // Nota de ajuste/devolução não tem pagamento, e "sem pagamento" (90) é a
    // declaração de que nada foi pago — nos dois casos não há soma para fechar.
    const semPagamento =
      pagamentosFiscais.length === 1 && pagamentosFiscais[0]?.tPag === "90";
    const exigePagamento =
      !semPagamento && ![3, 4].includes(finalidadeToFinNFe(input.operacao.finalidade));
    if (exigePagamento && Math.abs(totalPagamentos - totalNota) > 0.01) {
      errors.push({
        step: "payment",
        field: "pagamentos",
        message: `A soma dos pagamentos (${totalPagamentos.toFixed(2)}) deve ser igual ao total da NF-e (${totalNota.toFixed(2)}).`,
      });
    }
  }

  const rawModFrete = cleanText(input.transporte?.modFrete || "9");
  const transporteFiscal = getTransporteFiscal(input);
  if (!["0", "1", "2", "3", "4", "9"].includes(rawModFrete)) {
    errors.push({
      step: "transport",
      field: "modFrete",
      message: "Modalidade de frete invÃ¡lida para NF-e.",
    });
  }

  if (["0", "1", "2"].includes(transporteFiscal.modFrete)) {
    const docTransportadora = onlyDigits(transporteFiscal.transportadora?.documento);
    if (!cleanText(transporteFiscal.transportadora?.nome)) {
      errors.push({
        step: "transport",
        field: "transportadora.nome",
        message: "Nome da transportadora Ã© obrigatÃ³rio quando o frete Ã© contratado.",
      });
    }
    if (docTransportadora.length !== 11 && docTransportadora.length !== 14) {
      errors.push({
        step: "transport",
        field: "transportadora.documento",
        message: "CPF ou CNPJ da transportadora deve ser vÃ¡lido quando o frete Ã© contratado.",
      });
    }
    if (cleanText(transporteFiscal.transportadora?.uf).length !== 2) {
      errors.push({
        step: "transport",
        field: "transportadora.uf",
        message: "UF da transportadora Ã© obrigatÃ³ria quando o frete Ã© contratado.",
      });
    }
  }

  const placa = cleanText(transporteFiscal.veiculo?.placa);
  if (placa && placa.length !== 7) {
    errors.push({
      step: "transport",
      field: "veiculo.placa",
      message: "Placa do veÃ­culo deve ter 7 caracteres.",
    });
  }

  return errors;
}

export function validarLimiteTotalDevolucao(
  totalDevolucao: number,
  totalDocumentosReferenciados: number,
): ValidationError[] {
  const devolucao = Number(totalDevolucao.toFixed(2));
  const referenciado = Number(totalDocumentosReferenciados.toFixed(2));
  if (devolucao <= referenciado) return [];

  return [{
    step: "products",
    field: "valorUnitario",
    message:
      `O total da devolução (R$ ${devolucao.toFixed(2)}) supera o total da NF-e ` +
      `referenciada (R$ ${referenciado.toFixed(2)}). Use os valores fiscais da compra; ` +
      "a SEFAZ rejeita essa situação pelo código 545.",
  }];
}

async function validarTotalDevolucaoComDocumentosLocais(
  input: NFeAvulsaDraftInput,
  itens: NFeItem[],
  crt: CRT,
) {
  if (finalidadeToFinNFe(input.operacao.finalidade) !== 4) return [];

  const chaves = Array.from(new Set([
    ...(input.documentosReferenciados ?? []).map((item) => onlyDigits(item.chaveAcesso)),
    ...input.itens.map((item) => onlyDigits(item.dfeReferenciado?.chaveAcesso)),
  ].filter((chave) => chave.length === 44)));
  if (!chaves.length) return [];

  const { data, error } = await supabaseAdmin
    .from("fiscal_dfe_documento")
    .select("chave_acesso, valor_total, schema")
    .in("chave_acesso", chaves);
  if (error) throw error;

  const documentos = new Map<string, { total: number; completo: boolean }>();
  (data ?? []).forEach((row: any) => {
    const chave = onlyDigits(row.chave_acesso);
    const atual = documentos.get(chave);
    const completo = String(row.schema ?? "").startsWith("procNFe");
    if (!atual || (completo && !atual.completo)) {
      documentos.set(chave, { total: toDecimalNumber(row.valor_total), completo });
    }
  });
  // A regra da SEFAZ só compara quando conhece todas as notas referenciadas.
  // Se o ERP ainda não baixou algum documento, não inventamos um limite.
  if (chaves.some((chave) => !documentos.has(chave))) return [];

  const soma = calcularTotaisNFe(itens, crt);
  const frete = itens.reduce((total, item) => total + toDecimalNumber(item.valorFrete), 0);
  const totalDevolucao =
    soma.vProd - soma.vDesc + frete + soma.vST + soma.vFCPST + soma.vIPI + soma.vIPIDevol;
  const totalReferenciado = chaves.reduce(
    (total, chave) => total + (documentos.get(chave)?.total ?? 0),
    0,
  );
  return validarLimiteTotalDevolucao(totalDevolucao, totalReferenciado);
}

/**
 * Dados que a tela de emissão precisa: empresa, configuração do modelo, regras
 * fiscais e a previsão do próximo número.
 *
 * O filtro por modelo é obrigatório. Sem ele, esta função devolvia sempre a
 * primeira linha de `nfe_config` — a da NF-e — e a tela de NFC-e exibia a série
 * e o número da NF-e, além do ambiente errado. Ler "PRODUÇÃO" numa emissão que
 * na verdade sai em homologação é o pior tipo de informação errada.
 */
export async function getNFeAvulsaSetup(modelo: ModeloDocumentoFiscal = MODELO_NFE) {
  const { data: config, error: configError } = await supabaseAdmin
    .from("nfe_config")
    .select("id, empresaid, modelo, serie, ultimo_numero, ambiente")
    .eq("modelo", modeloParaDb(modelo))
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle<NFeConfigRow>();

  if (configError) throw configError;

  const { data: empresa, error: empresaError } = config
    ? await supabaseAdmin.from("empresa").select("*").eq("id", config.empresaid).maybeSingle<EmpresaRow>()
    : { data: null, error: null };

  if (empresaError) throw empresaError;

  let certificadoStatus = "Não configurado";
  if (empresa?.certificadocaminho && empresa?.certificadosenha) {
    try {
      await carregarCertificadoA1(empresa);
      certificadoStatus = "Certificado A1 disponível";
    } catch (error: any) {
      certificadoStatus = `Certificado inválido: ${error?.message ?? String(error)}`;
    }
  }

  const { data: clientes, error: clientesError } = await supabaseAdmin
    .from("cliente")
    .select("id, nomerazaosocial, cpfcnpj, cidade, estado")
    .eq("is_deleted", false)
    .order("nomerazaosocial", { ascending: true })
    .limit(200);

  if (clientesError) throw clientesError;

  const { data: produtos, error: produtosError } = await supabaseAdmin
    .from("produto")
    .select("id, titulo, descricao, precovenda, ncm, cfop, unidade, origem_mercadoria, csosn, cst, aliquotaicms, cst_pis, aliquota_pis, modo_pis, aliquota_por_unidade_pis, cst_cofins, aliquota_cofins, modo_cofins, aliquota_por_unidade_cofins, cest, rtc_habilitado, cst_ibscbs, cclass_trib, aliquota_ibs_uf, aliquota_ibs_municipio, aliquota_cbs")
    .eq("is_deleted", false)
    .order("titulo", { ascending: true })
    .limit(300);

  if (produtosError) throw produtosError;

  const today = new Date().toISOString().slice(0, 10);
  const { data: classificacoesRtc, error: classificacoesError } = await supabaseAdmin
    .from("fiscal_nfe_classificacao_tributaria")
    .select("codigo, cst, nome, descricao, percentual_reducao_ibs, percentual_reducao_cbs, inicio_vigencia, fim_vigencia, permite_nfe, indicadores, versao_fonte")
    .eq("permite_nfe", true)
    .lte("inicio_vigencia", today)
    .or(`fim_vigencia.is.null,fim_vigencia.gte.${today}`)
    .order("cst", { ascending: true })
    .order("codigo", { ascending: true });

  if (classificacoesError) throw classificacoesError;
  const { data: cstRtc, error: cstRtcError } = await supabaseAdmin
    .from("fiscal_nfe_cst_ibscbs")
    .select("cst, indicadores")
    .eq("versao_fonte", "IT2025.002-v1.60-2026-06-22");
  if (cstRtcError) throw cstRtcError;
  const cstPadraoDisponivel = new Set((cstRtc ?? [])
    .filter((row: any) => Number(row.indicadores?.ind_gIBSCBS) === 1 && Number(row.indicadores?.ind_gDif) === 0)
    .map((row: any) => row.cst));
  const crt = empresa?.regimetributario ? Number(empresa.regimetributario) as CRT : null;
  // Com que número a próxima nota deve sair. Previsão, não reserva: o número é
  // alocado de fato na transmissão.
  const proximoNumero = config ? await preverProximoNumero(config) : null;

  return {
    empresa,
    config,
    proximoNumero,
    empresaErros: validarEmpresa(empresa, config, modelo),
    certificadoStatus,
    clientes: clientes ?? [],
    produtos: produtos ?? [],
    unidades: Array.from(unidadesPermitidas),
    regrasFiscais: crt ? getNFeFiscalFieldRules(crt) : null,
    versaoRegraFiscal: NFE_FISCAL_RULE_VERSION,
    classificacoesRtc: (classificacoesRtc ?? []).filter((row: any) => cstPadraoDisponivel.has(row.cst)).map((row: any) => ({
      codigo: row.codigo,
      cst: row.cst,
      nome: row.nome,
      descricao: row.descricao,
      percentualReducaoIbs: row.percentual_reducao_ibs,
      percentualReducaoCbs: row.percentual_reducao_cbs,
      inicioVigencia: row.inicio_vigencia,
      fimVigencia: row.fim_vigencia,
      permiteNfe: row.permite_nfe,
      indicadores: row.indicadores,
      versaoFonte: row.versao_fonte,
    })),
  };
}

async function getConfigAndEmpresa(modelo: ModeloDocumentoFiscal = MODELO_NFE) {
  // Filtro por modelo é obrigatório: NF-e e NFC-e têm linhas separadas em
  // `nfe_config`, com séries e contadores independentes.
  const { data: config, error: configError } = await supabaseAdmin
    .from("nfe_config")
    .select("id, empresaid, modelo, serie, ultimo_numero, ambiente")
    .eq("modelo", modeloParaDb(modelo))
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle<NFeConfigRow>();

  if (configError) throw configError;
  if (!config) {
    throw new Error(
      `Configuração de ${rotuloModelo(modelo)} não encontrada. Cadastre a série em Configurações › Fiscal.`,
    );
  }

  const { data: empresa, error: empresaError } = await supabaseAdmin
    .from("empresa")
    .select("*")
    .eq("id", config.empresaid)
    .maybeSingle<EmpresaRow>();

  if (empresaError) throw empresaError;
  if (!empresa) throw new Error("Empresa da configuração fiscal não encontrada.");

  const empresaErros = validarEmpresa(empresa, config, modelo);
  if (empresaErros.length > 0) {
    throw new Error(`Corrija o cadastro da empresa antes de emitir: ${empresaErros.join(" ")}`);
  }

  return { config, empresa };
}

function mapItemToInsert(item: NFeAvulsaItemInput, index: number, nfeId: number, fiscalItem?: NFeItem) {
  const taxItem = fiscalItem ?? mapInputToTaxItem(item, index);
  const quantidade = taxItem.quantidade;
  const valorUnitario = taxItem.valorUnitario;
  const valorTotal = taxItem.valorTotal;
  const valorDesconto = Number(taxItem.valorDesconto ?? 0);
  // Base dos tributos é o item já líquido do desconto incondicional.
  const valorLiquido = Number((valorTotal - valorDesconto).toFixed(2));
  const aliquotaIcms = taxItem.aliquotaIcms ?? null;
  const aliquotaPis = taxItem.pis?.aliquota ?? taxItem.aliquotaPis ?? null;
  const aliquotaCofins = taxItem.cofins?.aliquota ?? taxItem.aliquotaCofins ?? null;

  return {
    nfe_id: nfeId,
    n_item: index + 1,
    produtoid: item.produtoId ?? null,
    descricao: cleanText(item.descricao),
    ncm: onlyDigits(item.ncm),
    cfop: onlyDigits(item.cfop),
    csosn: cleanText(item.csosn) || null,
    cst: cleanText(item.cst) || null,
    origem_mercadoria: cleanText(taxItem.orig) || null,
    cest: onlyDigits(item.cest) || null,
    unidade: cleanText(item.unidade) || "UN",
    quantidade,
    valor_unitario: valorUnitario,
    valor_total: valorTotal,
    valor_desconto: valorDesconto,
    valor_frete: Number(taxItem.valorFrete ?? 0),
    aliquotaicms: aliquotaIcms,
    valor_bc_icms: aliquotaIcms === null ? null : valorLiquido,
    valor_icms: aliquotaIcms === null ? null : Number((valorLiquido * (aliquotaIcms / 100)).toFixed(2)),
    cst_pis: cleanText(item.cstPis) || null,
    aliquota_pis: aliquotaPis,
    valor_pis: taxItem.pis?.valor ?? (aliquotaPis === null ? null : Number((Number(taxItem.pis?.base ?? valorLiquido) * (aliquotaPis / 100)).toFixed(2))),
    cst_cofins: cleanText(item.cstCofins) || null,
    aliquota_cofins: aliquotaCofins,
    valor_cofins: taxItem.cofins?.valor ?? (aliquotaCofins === null ? null : Number((Number(taxItem.cofins?.base ?? valorLiquido) * (aliquotaCofins / 100)).toFixed(2))),
    tributacao_snapshot: {
      ...taxItem,
      ...(item.sourceItemId ? { sourceItemId: item.sourceItemId } : {}),
      // Guarda de onde veio cada campo fiscal. Um item que saiu errado por
      // causa do padrão de Configurações não se conserta mexendo no produto,
      // e sem este registro não há como saber qual dos dois falhou.
      ...(item.procedenciaFiscal ? { procedenciaFiscal: item.procedenciaFiscal } : {}),
    },
    updatedat: new Date().toISOString(),
  };
}

export async function salvarNFeAvulsaDraft(input: NFeAvulsaDraftInput) {
  const modelo = input.modelo ?? MODELO_NFE;
  const isNfce = modelo === MODELO_NFCE;

  input = {
    ...input,
    destinatario: normalizeFiscalRecipient(input.destinatario),
  };
  const errors = validarDraftAvulso(input);
  if (errors.length > 0) {
    return { ok: false as const, errors };
  }

  // O município do destinatário só é resolvido no IBGE quando o documento
  // realmente exige endereço. Na NFC-e o consumidor pode nem estar
  // identificado, e cobrar código IBGE de quem comprou no balcão travaria a
  // venda por um dado que a nota não leva.
  if (!isNfce && input.destinatario.tipoPessoa !== "ESTRANGEIRO") {
    try {
      input.destinatario.cidade = await resolverNomeMunicipioIbge(
        input.destinatario.codigoMunicipio ?? "",
        input.destinatario.estado,
      );
    } catch (error: any) {
      return {
        ok: false as const,
        errors: [{
          step: "recipient",
          field: "codigoMunicipio",
          message: error?.message || "Não foi possível validar o município no IBGE.",
        }],
      };
    }
  }

  const { config, empresa } = await getConfigAndEmpresa(modelo);
  const empresaUf = cleanText(empresa.uf).toUpperCase();
  const destinatarioUf = cleanText(input.destinatario.estado).toUpperCase();
  const cfopErrors: ValidationError[] = input.itens.flatMap((item, itemIndex) => {
    const cfop = onlyDigits(item.cfop);
    if (
      cfop.length === 4 &&
      !isCfopCompatibleWithOperation(
        cfop,
        input.operacao.tipoOperacao,
        empresaUf,
        destinatarioUf,
      )
    ) {
      return [{
        step: "products",
        itemIndex,
        field: "cfop",
        message: `CFOP ${cfop} é incompatível com a operação de ${input.operacao.tipoOperacao === "ENTRADA" ? "entrada" : "saída"} e o destino informado.`,
      }];
    }
    return [];
  });
  if (cfopErrors.length > 0) return { ok: false as const, errors: cfopErrors };

  const crt = Number(empresa.regimetributario) as CRT;
  const issueDate = new Date();
  const selectedClassCodes = Array.from(new Set(input.itens.map((item) => cleanText(item.cClassTrib)).filter(Boolean)));
  let classificationsByCode = new Map<string, ClassificacaoTributariaRtc>();
  let validStandardRtcCsts = new Set<string>();
  if (selectedClassCodes.length > 0) {
    const issueDay = issueDate.toISOString().slice(0, 10);
    const { data: rows, error: classError } = await supabaseAdmin
      .from("fiscal_nfe_classificacao_tributaria")
      .select("codigo, cst, nome, descricao, percentual_reducao_ibs, percentual_reducao_cbs, inicio_vigencia, fim_vigencia, permite_nfe, indicadores, versao_fonte")
      .in("codigo", selectedClassCodes)
      .lte("inicio_vigencia", issueDay)
      .or(`fim_vigencia.is.null,fim_vigencia.gte.${issueDay}`);
    if (classError) throw classError;
    classificationsByCode = new Map((rows ?? []).map((row: any) => [row.codigo, {
      codigo: row.codigo,
      cst: row.cst,
      nome: row.nome,
      descricao: row.descricao,
      percentualReducaoIbs: row.percentual_reducao_ibs,
      percentualReducaoCbs: row.percentual_reducao_cbs,
      inicioVigencia: row.inicio_vigencia,
      fimVigencia: row.fim_vigencia,
      permiteNfe: row.permite_nfe,
      indicadores: row.indicadores,
      versaoFonte: row.versao_fonte,
    } as ClassificacaoTributariaRtc]));
    const { data: cstRows, error: cstError } = await supabaseAdmin
      .from("fiscal_nfe_cst_ibscbs")
      .select("cst, indicadores")
      .eq("versao_fonte", "IT2025.002-v1.60-2026-06-22");
    if (cstError) throw cstError;
    validStandardRtcCsts = new Set((cstRows ?? [])
      .filter((row: any) => Number(row.indicadores?.ind_gIBSCBS) === 1 && Number(row.indicadores?.ind_gDif) === 0)
      .map((row: any) => row.cst));
  }

  const itensXml = input.itens.map(mapInputToTaxItem);
  for (const item of itensXml) {
    if (!item.rtc) continue;
    const classification = classificationsByCode.get(item.rtc.cClassTrib);
    if (classification) {
      item.rtc.versaoClassificacao = classification.versaoFonte;
      item.rtc.validadoEm = issueDate.toISOString();
    }
    const reductionIbs = Number(classification?.percentualReducaoIbs ?? 0);
    const reductionCbs = Number(classification?.percentualReducaoCbs ?? 0);
    const applyReduction = (part: typeof item.rtc.ibsUf, reduction: number) => {
      if (reduction <= 0) return;
      part.percentualReducao = reduction;
      part.aliquotaEfetiva = Number((part.aliquota * (1 - reduction / 100)).toFixed(4));
      part.valor = Number((item.rtc!.baseCalculo * part.aliquotaEfetiva / 100).toFixed(2));
    };
    applyReduction(item.rtc.ibsUf, reductionIbs);
    applyReduction(item.rtc.ibsMunicipio, reductionIbs);
    applyReduction(item.rtc.cbs, reductionCbs);
    item.rtc.valorIbs = Number((item.rtc.ibsUf.valor + item.rtc.ibsMunicipio.valor).toFixed(2));
  }
  const taxErrors: ValidationError[] = itensXml.flatMap((item, itemIndex) => {
    const issues = validateNFeItemTax(item, crt, {
      issueDate,
      classificacaoRtc: item.rtc ? classificationsByCode.get(item.rtc.cClassTrib) ?? null : null,
    });
    if (item.rtc && !validStandardRtcCsts.has(item.rtc.cstIbsCbs)) {
      issues.push({
        code: "NFE_IBSCBS_GROUP_NOT_SUPPORTED",
        field: "rtc.cClassTrib",
        message: "A classificação exige grupo RTC especial (monofásico, diferimento ou sem cálculo) ainda não disponível nesta tela.",
      });
    }
    return issues.map((issue) => ({
      step: "products",
      itemIndex,
      field: issue.field,
      message: `${issue.code}: ${issue.message}`,
    }));
  });
  if (taxErrors.length > 0) return { ok: false as const, errors: taxErrors };

  const limiteDevolucaoErrors = await validarTotalDevolucaoComDocumentosLocais(
    input,
    itensXml,
    crt,
  );
  if (limiteDevolucaoErrors.length > 0) {
    return { ok: false as const, errors: limiteDevolucaoErrors };
  }

  const nomeMunicipioEmitente = await resolverNomeMunicipioIbge(
    empresa.codigomunicipio,
    empresa.uf
  );
  const destinatario = getDestinatarioSnapshot(input, empresa);
  const pagamento = getPagamentoFiscal(input);
  const pagamentos = getPagamentosFiscais(input);
  const pagamentoDadosAvulsos = getPagamentoDadosAvulsos(input);
  const pagamentosDadosAvulsos = getPagamentosDadosAvulsos(input);
  const transporte = getTransporteFiscal(input);
  const transporteDadosAvulsos = getTransporteDadosAvulsos(input);
  // A tela manda a chave como o usuário digitou (com pontos, espaço colado da
  // consulta pública). O XML e o snapshot guardam só os 44 dígitos.
  const documentosReferenciados = (input.documentosReferenciados ?? [])
    .map((referencia) => ({ chaveAcesso: onlyDigits(referencia?.chaveAcesso) }))
    .filter((referencia) => referencia.chaveAcesso.length === 44);

  // Validações do modelo 65 e da UF do emitente. Rodam com os totais já
  // calculados a partir dos itens fiscais — a regra da Paraíba depende do valor
  // do documento, e esperar a rejeição 750 da SEFAZ queima número de nota com o
  // cliente esperando no balcão.
  if (isNfce) {
    const totalDocumento = Number(
      itensXml
        .reduce(
          (total, item) =>
            total +
            Number(item.valorTotal ?? 0) -
            Number(item.valorDesconto ?? 0) +
            Number(item.valorFrete ?? 0),
          0,
        )
        .toFixed(2),
    );
    const totalPago = pagamentos.reduce(
      (total, pagamento) => total + toDecimalNumber(pagamento.valor),
      0,
    );

    const violacoes = validarNfce({
      uf: cleanText(empresa.uf).toUpperCase(),
      ambiente: empresa.ambiente === "PRODUCAO" ? "PRODUCAO" : "HOMOLOGACAO",
      tpEmis: 1,
      indPres: input.operacao.indicadorPresenca,
      finNFe: finalidadeToFinNFe(input.operacao.finalidade),
      tipoOperacao: input.operacao.tipoOperacao,
      consumidor: destinatario
        ? { cpf: destinatario.cpf ?? null, cnpj: destinatario.cnpj ?? null }
        : null,
      itens: itensXml,
      totalPago,
      totalDocumento,
    });

    if (violacoes.length > 0) {
      return {
        ok: false as const,
        errors: violacoes.map((violacao) => ({
          step: violacao.field?.startsWith("destinatario")
            ? "recipient"
            : violacao.field?.startsWith("pagamentos")
              ? "payment"
              : violacao.field === "itens"
                ? "products"
                : "operation",
          field: violacao.field,
          message: violacao.message,
        })),
      };
    }
  }
  // Só eco do que a tela mandou: o rateio já veio pronto em cada item.
  const descontoGeralInformado = Number(
    Math.max(0, toDecimalNumber(input.descontoGeral)).toFixed(2),
  );
  const now = new Date().toISOString();
  const itensInsertBase = input.itens.map((item, index) => mapItemToInsert(item, index, 0, itensXml[index]));
  // Vínculo com a origem. O motor fiscal reabre a nota sem esse bloco — ele é
  // recuperado do que já está gravado no branch de atualização, senão salvar
  // uma nota de OS/venda por lá a transformaria numa nota solta.
  let origem = input.origem ?? null;
  let fornecedorId = origem?.fornecedorId ?? null;
  let clienteId = fornecedorId
    ? null
    : input.destinatario.clienteId ?? origem?.clienteId ?? null;

  let nfeId = Number(input.nfeId ?? 0);
  let numero: number;
  let serie: number;
  let chave: string;
  let xml: string;

  if (!nfeId) {
    // Número provisório: serve só para a prévia do XML e do DANFE terem uma
    // chave de acesso. O definitivo é alocado na transmissão
    // (`garantirNumeroDefinitivo`), para rascunho excluído ou nota rejeitada
    // não furarem a sequência da SEFAZ.
    numero = Number(config.ultimo_numero ?? 0) + 1;
    serie = Number(config.serie);
    ({ xml, chave } = buildNFePreviewXml(empresa, numero, serie, itensXml, destinatario, {
      tpNF: input.operacao.tipoOperacao === "ENTRADA" ? 0 : 1,
      nomeMunicipioEmitente,
      natOp: cleanText(input.operacao.naturezaOperacao),
      indFinal: input.operacao.consumidorFinal ? 1 : 0,
      indPres: Number(input.operacao.indicadorPresenca || 1) as any,
      finNFe: finalidadeToFinNFe(input.operacao.finalidade),
      observacoesFiscais: input.operacao.observacoesFiscais,
      modelo,
      // Ambiente fiscal é único e vem do cadastro da empresa: trocar lá muda
      // NF-e e NFC-e juntas. A coluna nfe_config.ambiente é só um espelho,
      // mantido por trigger.
      ambiente: empresa.ambiente,
      pagamento,
      pagamentos,
      transporte,
      documentosReferenciados,
    }));

    const { data: nfe, error: insertError } = await supabaseAdmin
      .from("nfe")
      .insert({
        modelo: modeloParaDb(modelo),
        serie,
        numero,
        chave_acesso: chave,
        numero_definitivo: false,
        // Carimba na nota o ambiente com que ela foi montada. É esse valor que
        // a transmissão e o cancelamento usam depois, mesmo que a empresa mude
        // de ambiente no meio do caminho.
        ambiente: empresa.ambiente ?? "HOMOLOGACAO",
        status: "RASCUNHO",
        ordemservicoid: origem?.ordemServicoId ?? null,
        vendaid: origem?.vendaId ?? null,
        entradaid: origem?.entradaId ?? null,
        saidaid: origem?.saidaId ?? null,
        fornecedorid: fornecedorId,
        clienteid: clienteId,
        destinatario_snapshot: destinatario,
        emitente_snapshot: {
          id: empresa.id,
          cnpj: empresa.cnpj,
          razaosocial: empresa.razaosocial,
          nomefantasia: empresa.nomefantasia,
          inscricaoestadual: empresa.inscricaoestadual,
          endereco: empresa.endereco,
          numero: empresa.numero,
          bairro: empresa.bairro,
          cidade: empresa.codigomunicipio,
          uf: empresa.uf,
          cep: empresa.cep,
          regimetributario: empresa.regimetributario,
        },
        dados_avulsos: {
          origem: origem ?? { tipo: "AVULSA" },
          operacao: input.operacao,
          pagamento: pagamentoDadosAvulsos,
          pagamentos: pagamentosDadosAvulsos,
          transporte: transporteDadosAvulsos,
          destinatario: input.destinatario,
          descontoGeral: descontoGeralInformado,
          clienteSelecionadoId: input.destinatario.clienteId ?? null,
          fornecedorSelecionadoId: fornecedorId,
          versaoRegraFiscal: NFE_FISCAL_RULE_VERSION,
          documentosReferenciados,
        },
        versao_regra_fiscal: NFE_FISCAL_RULE_VERSION,
        decisao_fiscal: {
          modelo: String(modelo),
          crt,
          dataEmissao: now,
          classificacoesRtc: itensXml.filter((item) => item.rtc).map((item) => ({
            item: item.numeroItem,
            cst: item.rtc?.cstIbsCbs,
            cClassTrib: item.rtc?.cClassTrib,
            versaoFonte: classificationsByCode.get(item.rtc?.cClassTrib ?? "")?.versaoFonte,
          })),
        },
        empresaid: Number(config.empresaid),
        dataemissao: now,
        total_produtos: 0,
        total_servicos: 0,
        total_nfe: 0,
        tpNF: input.operacao.tipoOperacao === "ENTRADA" ? 0 : 1,
        cfop: onlyDigits(input.itens[0]?.cfop),
        xml_assinado: xml,
        xml_autorizado: null,
      })
      .select("id, numero, serie")
      .single();

    if (insertError || !nfe) {
      throw new Error(`Erro ao criar rascunho de NF-e avulsa: ${insertError?.message ?? "ID não retornado"}`);
    }

    nfeId = Number(nfe.id);
  } else {
    const { data: nfe, error: nfeError } = await supabaseAdmin
      .from("nfe")
      .select(
        "id, status, modelo, numero, serie, ordemservicoid, vendaid, entradaid, saidaid, clienteid, fornecedorid, dados_avulsos",
      )
      .eq("id", nfeId)
      .maybeSingle();

    if (nfeError) throw nfeError;
    if (!nfe) throw new Error("Rascunho não encontrado.");
    if (!["RASCUNHO", "REJEITADA"].includes(String(nfe.status))) {
      throw new Error("Somente nota em rascunho ou rejeitada pode ser alterada.");
    }
    // Modelo é imutável: o número, a série e a chave já foram montados com ele.
    // Reabrir um rascunho de NF-e como NFC-e produziria uma chave inconsistente
    // com a numeração gravada.
    if (nfe.modelo !== modeloParaDb(modelo)) {
      throw new Error(
        `Este rascunho é de ${nfe.modelo === "NFCE" ? "NFC-e" : "NF-e"} e não pode ser reaberto como ${rotuloModelo(modelo)}.`,
      );
    }

    // O motor fiscal reabre a nota e devolve o rascunho sem o bloco de origem.
    // Nesse caso vale o que já está gravado: são as colunas que ligam a nota à
    // OS, à venda ou à entrada, e perdê-las desvincula a nota da origem.
    if (!input.origem) {
      const origemGravada = (nfe.dados_avulsos as { origem?: typeof origem } | null)?.origem ?? null;
      origem = {
        tipo:
          origemGravada?.tipo ??
          (nfe.ordemservicoid ? "OS" : nfe.vendaid ? "VENDA" : nfe.entradaid ? "ENTRADA" : nfe.saidaid ? "SAIDA" : "AVULSA"),
        ordemServicoId: nfe.ordemservicoid ?? origemGravada?.ordemServicoId ?? null,
        vendaId: nfe.vendaid ?? origemGravada?.vendaId ?? null,
        entradaId: nfe.entradaid ?? origemGravada?.entradaId ?? null,
        saidaId: nfe.saidaid ?? origemGravada?.saidaId ?? null,
        clienteId: nfe.clienteid ?? origemGravada?.clienteId ?? null,
        fornecedorId: nfe.fornecedorid ?? origemGravada?.fornecedorId ?? null,
      };
      fornecedorId = origem.fornecedorId ?? null;
      clienteId = fornecedorId
        ? null
        : input.destinatario.clienteId ?? origem.clienteId ?? null;
    }

    numero = Number(nfe.numero);
    serie = Number(nfe.serie);
    ({ xml, chave } = buildNFePreviewXml(empresa, numero, serie, itensXml, destinatario, {
      tpNF: input.operacao.tipoOperacao === "ENTRADA" ? 0 : 1,
      nomeMunicipioEmitente,
      natOp: cleanText(input.operacao.naturezaOperacao),
      indFinal: input.operacao.consumidorFinal ? 1 : 0,
      indPres: Number(input.operacao.indicadorPresenca || 1) as any,
      finNFe: finalidadeToFinNFe(input.operacao.finalidade),
      observacoesFiscais: input.operacao.observacoesFiscais,
      modelo,
      // Ambiente fiscal é único e vem do cadastro da empresa: trocar lá muda
      // NF-e e NFC-e juntas. A coluna nfe_config.ambiente é só um espelho,
      // mantido por trigger.
      ambiente: empresa.ambiente,
      pagamento,
      pagamentos,
      transporte,
      documentosReferenciados,
    }));

    const { error: updateError } = await supabaseAdmin
      .from("nfe")
      .update({
        chave_acesso: chave,
        ordemservicoid: origem?.ordemServicoId ?? null,
        vendaid: origem?.vendaId ?? null,
        entradaid: origem?.entradaId ?? null,
        saidaid: origem?.saidaId ?? null,
        fornecedorid: fornecedorId,
        clienteid: clienteId,
        destinatario_snapshot: destinatario,
        dados_avulsos: {
          origem: origem ?? { tipo: "AVULSA" },
          operacao: input.operacao,
          pagamento: pagamentoDadosAvulsos,
          pagamentos: pagamentosDadosAvulsos,
          transporte: transporteDadosAvulsos,
          destinatario: input.destinatario,
          descontoGeral: descontoGeralInformado,
          clienteSelecionadoId: input.destinatario.clienteId ?? null,
          fornecedorSelecionadoId: fornecedorId,
          versaoRegraFiscal: NFE_FISCAL_RULE_VERSION,
          documentosReferenciados,
        },
        versao_regra_fiscal: NFE_FISCAL_RULE_VERSION,
        decisao_fiscal: {
          modelo: String(modelo),
          crt,
          dataEmissao: now,
          classificacoesRtc: itensXml.filter((item) => item.rtc).map((item) => ({
            item: item.numeroItem,
            cst: item.rtc?.cstIbsCbs,
            cClassTrib: item.rtc?.cClassTrib,
            versaoFonte: classificationsByCode.get(item.rtc?.cClassTrib ?? "")?.versaoFonte,
          })),
        },
        tpNF: input.operacao.tipoOperacao === "ENTRADA" ? 0 : 1,
        cfop: onlyDigits(input.itens[0]?.cfop),
        total_produtos: 0,
        total_nfe: 0,
        xml_assinado: xml,
        updatedat: now,
      })
      .eq("id", nfeId);

    if (updateError) throw updateError;

    const { error: deleteItemsError } = await supabaseAdmin.from("nfe_item").delete().eq("nfe_id", nfeId);
    if (deleteItemsError) throw deleteItemsError;
  }

  const itensInsert = itensInsertBase.map((item) => ({ ...item, nfe_id: nfeId }));
  const { error: itensError } = await supabaseAdmin.from("nfe_item").insert(itensInsert);
  if (itensError) throw itensError;

  const totalProdutos = itensInsert.reduce((sum, item) => sum + Number(item.valor_total ?? 0), 0);
  const totalDesconto = itensInsert.reduce((sum, item) => sum + Number(item.valor_desconto ?? 0), 0);
  const totalFrete = itensInsert.reduce((sum, item) => sum + Number(item.valor_frete ?? 0), 0);
  const totalIpiDevolvido = itensXml.reduce(
    (sum, item) => sum + Number(item.valorIpiDevolvido ?? 0),
    0,
  );
  const totalNfe = Number((totalProdutos - totalDesconto + totalFrete + totalIpiDevolvido).toFixed(2));
  const { error: totalError } = await supabaseAdmin.rpc("atualizar_totais_nfe", { p_nfe_id: nfeId });
  if (totalError) {
    const { error: updateTotalError } = await supabaseAdmin
      .from("nfe")
      .update({
        total_produtos: totalProdutos,
        valor_desconto: totalDesconto,
        valor_frete: totalFrete,
        total_nfe: totalNfe,
        updatedat: now,
      })
      .eq("id", nfeId);
    if (updateTotalError) throw updateTotalError;
  }

  const { error: xmlError } = await supabaseAdmin
    .from("nfe")
    .update({
      chave_acesso: chave,
      xml_assinado: xml,
      total_produtos: totalProdutos,
      valor_desconto: totalDesconto,
      valor_frete: totalFrete,
      total_nfe: totalNfe,
      updatedat: now,
    })
    .eq("id", nfeId);

  if (xmlError) throw xmlError;

  return {
    ok: true as const,
    nfeId,
    numero,
    serie,
    chave,
    total: totalNfe,
    errors: [],
  };
}

export async function buscarNFeAvulsaDraft(nfeId: number) {
  const { data: nfe, error: nfeError } = await supabaseAdmin
    .from("nfe")
    .select("*, cliente:clienteid (id, nomerazaosocial, cpfcnpj), empresa:empresaid (id, razaosocial, nomefantasia, cnpj)")
    .eq("id", nfeId)
    .maybeSingle();

  if (nfeError) throw nfeError;
  if (!nfe) return null;

  // O editor avulso é exclusivo da NF-e modelo 55: ele não tem consumidor
  // opcional, QR Code nem as regras do modelo 65. Recusar aqui, na abertura, é
  // melhor que deixar o usuário preencher a tela inteira e só descobrir no
  // salvamento — e impede que um link com id de NFC-e misture os dois motores.
  if (nfe.modelo === "NFCE") {
    const erro = new Error(
      "Esta é uma NFC-e (modelo 65) e não pode ser editada aqui. " +
        "Corrija-a pelo assistente de NFC-e, na tela da venda ou da ordem de serviço.",
    );
    // Regra de negócio, não falha do servidor.
    (erro as Error & { statusCode?: number }).statusCode = 422;
    throw erro;
  }

  const { data: itens, error: itensError } = await supabaseAdmin
    .from("nfe_item")
    .select("*")
    .eq("nfe_id", nfeId)
    .order("n_item", { ascending: true });

  if (itensError) throw itensError;

  return {
    nfe,
    itens: itens ?? [],
  };
}
