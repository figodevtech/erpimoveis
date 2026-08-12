import type {
  CRT,
  ClassificacaoTributariaRtc,
  ModoCalculoPisCofins,
  NFeItem,
} from "@/lib/nfe/types";
import {
  getRequiredPisCofinsMode,
  validateNFeItemTax,
  type NFeFiscalFieldRules,
} from "@/lib/nfe/taxRules";
import {
  ALIQUOTA_INTERNA_POR_UF,
  aliquotaInterestadual,
  deveGerarICMSUFDest,
} from "@/lib/nfe/difal";
export { aplicarSugestaoDifal, type DifalContexto } from "@/lib/nfe/difal-sugestao";
import {
  isCfopCompatibleWithOperation,
  normalizeCfopForOperation,
  type NFeOperationDirection,
} from "@/lib/nfe/cfopOperation";
import { descontoPorItem } from "@/lib/nfe/descontoOrigem";

export type FiscalSetup = {
  empresa: {
    id: number;
    nome: string;
    uf?: string | null;
    crt?: string | number | null;
    ambiente?: string | null;
  } | null;
  config: {
    serie: number;
    ambiente: string;
    /** Número previsto para esta emissão; o definitivo sai na transmissão. */
    proximoNumero?: number | null;
  } | null;
  empresaErros: string[];
  unidades: string[];
  regrasFiscais: NFeFiscalFieldRules | null;
  versaoRegraFiscal: string;
  classificacoesRtc: ClassificacaoTributariaRtc[];
};

export type SourceProduct = {
  titulo: string;
  osProdutoId: string;
  sourceItemId: string;
  produtoId: number;
  descricao: string;
  quantidade: number;
  precoUnitario: number;
  subtotal: number;
  /** Desconto do item somado ao rateio do desconto geral da OS/venda. */
  valorDesconto?: number | null;
  /** Só o desconto do próprio item, sem o rateio: base para rerratear na tela. */
  valorDescontoProprio?: number | null;
  ncm: string | null;
  cfop: string | null;
  codigobarras: string | null;
  referencia?: string | null;
  unidade?: string | null;
  origem_mercadoria?: string | null;
  csosn?: string | null;
  cst?: string | null;
  cest?: string | null;
  aliquotaicms?: string | number | null;
  cst_pis?: string | null;
  aliquota_pis?: string | number | null;
  modo_pis?: AssistedFiscalItem["modoPis"] | null;
  aliquota_por_unidade_pis?: string | number | null;
  cst_cofins?: string | null;
  aliquota_cofins?: string | number | null;
  modo_cofins?: AssistedFiscalItem["modoCofins"] | null;
  aliquota_por_unidade_cofins?: string | number | null;
  rtc_habilitado?: boolean | null;
  cst_ibscbs?: string | null;
  cclass_trib?: string | null;
  aliquota_ibs_uf?: string | number | null;
  aliquota_ibs_municipio?: string | number | null;
  aliquota_cbs?: string | number | null;
  /**
   * De onde o servidor tirou cada campo fiscal: 'PRODUTO', 'PADRAO' (o perfil
   * cadastrado em Configurações), 'REGRA' (imposto pelo CST) ou 'VAZIO'.
   */
  procedenciaFiscal?: Record<string, string> | null;
};

export type AssistedFiscalItem = {
  sourceItemId: string;
  produtoId: number;
  codigo: string;
  titulo: string;
  descricao: string;
  quantidade: number;
  valorUnitario: number;
  subtotal: number;
  /**
   * Desconto incondicional do item (vDesc). Vem pré-preenchido com o desconto
   * do item somado ao rateio do desconto geral da origem, mas é editável: quem
   * emite pode renegociar o abatimento que vai para a nota.
   */
  valorDesconto: number;
  /**
   * Desconto que veio do próprio item na origem. Não é editado direto: serve de
   * piso quando o desconto geral é redigitado e o rateio refeito.
   */
  valorDescontoProprio: number;
  ncm: string;
  cfop: string;
  unidade: string;
  orig: string;
  csosn: string;
  cst: string;
  aliquotaIcms: string;
  cest: string;
  cstPis: string;
  modoPis: "" | ModoCalculoPisCofins;
  aliquotaPis: string;
  basePis: string;
  quantidadePis: string;
  aliquotaPorUnidadePis: string;
  valorPis: string;
  cstCofins: string;
  modoCofins: "" | ModoCalculoPisCofins;
  aliquotaCofins: string;
  baseCofins: string;
  quantidadeCofins: string;
  aliquotaPorUnidadeCofins: string;
  valorCofins: string;
  rtcHabilitado: boolean;
  cstIbsCbs: string;
  cClassTrib: string;
  baseRtc: string;
  aliquotaIbsUf: string;
  valorIbsUf: string;
  aliquotaIbsMunicipio: string;
  valorIbsMunicipio: string;
  aliquotaCbs: string;
  valorCbs: string;
  /**
   * DIFAL (ICMSUFDest). Pré-preenchido como sugestão quando a operação exige o
   * grupo, mas totalmente editável: a alíquota interna da UF de destino muda por
   * lei estadual, NCM e benefício fiscal, então quem confirma é o usuário.
   */
  difalHabilitado: boolean;
  difalAliquotaInterna: string;
  difalAliquotaInterestadual: string;
  difalAliquotaFcp: string;
  difalPercentualPartilha: string;
  difalBaseFcp: string;
  /**
   * Procedência de cada campo fiscal como o servidor a montou, chaveada pelo
   * nome de coluna (`csosn`, `cst_pis`, …). Serve só para a tela avisar o que
   * veio do padrão de Configurações e o que veio do cadastro do produto — não
   * entra no XML nem é reavaliada quando o usuário edita o campo.
   */
  procedenciaFiscal: Record<string, string>;
};

export type AssistedItemIssue = {
  code: string;
  field: string;
  message: string;
};

export function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

export function normalizeCode(value: unknown, size: number) {
  const digits = onlyDigits(value);
  return digits ? digits.padStart(size, "0").slice(-size) : "";
}

export function parseDecimal(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const sanitized = raw.replace(/[^\d,.-]/g, "");
  const normalized = sanitized.includes(",")
    ? sanitized.replace(/\./g, "").replace(",", ".")
    : sanitized;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function optionalDecimal(value: unknown) {
  return value === null || value === undefined || String(value).trim() === ""
    ? undefined
    : parseDecimal(value);
}

export function inferPisCofinsMode(
  cst: unknown,
  rate?: unknown,
): AssistedFiscalItem["modoPis"] {
  const required = getRequiredPisCofinsMode(cst);
  if (required) return required;
  if (String(cst ?? "").trim() && rate !== null && rate !== undefined && rate !== "") {
    return "PERCENTUAL";
  }
  return "";
}

export function createAssistedItem(
  source: SourceProduct,
  setup: FiscalSetup,
  context?: {
    tipoOperacao?: NFeOperationDirection;
    parceiroUf?: string | null;
    indFinal?: number | string;
    indIEDest?: number | string;
  },
): AssistedFiscalItem {
  const crt = Number(setup.empresa?.crt ?? 0);

  // Sugestão de DIFAL: só liga quando a operação realmente exige o grupo.
  // Os valores abaixo são ponto de partida — o usuário confirma ou corrige.
  const ufEmitente = String(setup.empresa?.uf ?? "");
  const ufDestino = String(context?.parceiroUf ?? "");
  const exigeDifal =
    (context?.tipoOperacao ?? "SAIDA") === "SAIDA" &&
    Boolean(ufEmitente && ufDestino) &&
    deveGerarICMSUFDest({
      ufEmitente,
      ufDestinatario: ufDestino,
      indFinal: context?.indFinal ?? 1,
      indIEDest: context?.indIEDest ?? 9,
      tpNF: 1,
      cfop: source.cfop,
    });
  const internaSugerida = exigeDifal
    ? ALIQUOTA_INTERNA_POR_UF[ufDestino.trim().toUpperCase()]
    : undefined;
  const modoPis = source.modo_pis || inferPisCofinsMode(source.cst_pis, source.aliquota_pis);
  const modoCofins =
    source.modo_cofins || inferPisCofinsMode(source.cst_cofins, source.aliquota_cofins);
  return {
    sourceItemId: source.sourceItemId,
    produtoId: source.produtoId,
    codigo: String(source.referencia || source.codigobarras || source.produtoId),
    titulo: source.titulo,
    descricao: source.descricao || source.titulo,
    quantidade: Number(source.quantidade || 0),
    valorUnitario: Number(source.precoUnitario || 0),
    subtotal: Number(source.subtotal || 0),
    valorDesconto: Math.max(0, Number(source.valorDesconto || 0)),
    valorDescontoProprio: Math.max(0, Number(source.valorDescontoProprio || 0)),
    ncm: onlyDigits(source.ncm),
    cfop: normalizeCfopForOperation(
      source.cfop,
      context?.tipoOperacao ?? "SAIDA",
      setup.empresa?.uf,
      context?.parceiroUf,
    ),
    unidade: source.unidade || "UN",
    orig: String(source.origem_mercadoria ?? ""),
    csosn: crt === 1 || crt === 4 ? normalizeCode(source.csosn, 3) : "",
    cst: crt === 2 || crt === 3 ? normalizeCode(source.cst, 2) : "",
    aliquotaIcms:
      source.aliquotaicms === null || source.aliquotaicms === undefined
        ? ""
        : String(source.aliquotaicms),
    cest: onlyDigits(source.cest),
    cstPis: normalizeCode(source.cst_pis, 2),
    modoPis,
    aliquotaPis:
      source.aliquota_pis === null || source.aliquota_pis === undefined
        ? ""
        : String(source.aliquota_pis),
    basePis: "",
    quantidadePis: modoPis === "QUANTIDADE" ? String(source.quantidade) : "",
    aliquotaPorUnidadePis:
      source.aliquota_por_unidade_pis == null ? "" : String(source.aliquota_por_unidade_pis),
    valorPis: "",
    cstCofins: normalizeCode(source.cst_cofins, 2),
    modoCofins,
    aliquotaCofins:
      source.aliquota_cofins === null || source.aliquota_cofins === undefined
        ? ""
        : String(source.aliquota_cofins),
    baseCofins: "",
    quantidadeCofins: modoCofins === "QUANTIDADE" ? String(source.quantidade) : "",
    aliquotaPorUnidadeCofins:
      source.aliquota_por_unidade_cofins == null
        ? ""
        : String(source.aliquota_por_unidade_cofins),
    valorCofins: "",
    rtcHabilitado:
      setup.regrasFiscais?.rtc.status === "REQUIRED" || Boolean(source.rtc_habilitado),
    cstIbsCbs: source.cst_ibscbs || "",
    cClassTrib: source.cclass_trib || "",
    baseRtc: "",
    aliquotaIbsUf: source.aliquota_ibs_uf == null ? "" : String(source.aliquota_ibs_uf),
    valorIbsUf: "",
    aliquotaIbsMunicipio:
      source.aliquota_ibs_municipio == null ? "" : String(source.aliquota_ibs_municipio),
    valorIbsMunicipio: "",
    aliquotaCbs: source.aliquota_cbs == null ? "" : String(source.aliquota_cbs),
    valorCbs: "",
    difalHabilitado: exigeDifal,
    // Interna vem da tabela de referência; vazia se a UF não estiver mapeada,
    // para o usuário pesquisar e preencher em vez de emitir com valor errado.
    difalAliquotaInterna: internaSugerida == null ? "" : String(internaSugerida),
    // Interestadual é a única com regra objetiva (Resolução 13/2012 + origem),
    // mas segue editável.
    difalAliquotaInterestadual: exigeDifal
      ? String(aliquotaInterestadual(ufEmitente, ufDestino, source.origem_mercadoria))
      : "",
    difalAliquotaFcp: "",
    difalPercentualPartilha: exigeDifal ? "100" : "",
    difalBaseFcp: "",
    procedenciaFiscal: source.procedenciaFiscal ?? {},
  };
}

/**
 * Perfil tributário devolvido pelo espelho da NF-e de origem.
 * Espelha `CamposFiscaisResolvidos` do servidor, em formato de transporte.
 */
export type EspelhoFiscalResposta = {
  campos: Record<string, unknown>;
  procedencia?: Record<string, string>;
  valorUnitario?: number | null;
};

/**
 * Reaplica num item já montado o perfil tributário lido da NF-e de origem.
 *
 * Serve à devolução, que precisa repetir a operação de compra: sobrepõe os
 * campos fiscais e o preço unitário mantendo quantidade, desconto e o que o
 * operador já tiver ajustado fora da tributação. A procedência entra junto para
 * a tela poder marcar o que veio da nota original.
 */
export function aplicarCamposFiscais(
  item: AssistedFiscalItem,
  espelho: EspelhoFiscalResposta,
): AssistedFiscalItem {
  const campos = espelho.campos ?? {};
  const texto = (valor: unknown) =>
    valor === null || valor === undefined ? "" : String(valor);
  // O espelho só manda o que conseguiu resolver: campo vazio mantém o valor
  // atual, para não apagar um ajuste manual com um branco vindo do servidor.
  const manter = (novo: unknown, atual: string) => texto(novo) || atual;

  const modoPis =
    (campos.modo_pis as AssistedFiscalItem["modoPis"]) ||
    inferPisCofinsMode(campos.cst_pis, campos.aliquota_pis) ||
    item.modoPis;
  const modoCofins =
    (campos.modo_cofins as AssistedFiscalItem["modoCofins"]) ||
    inferPisCofinsMode(campos.cst_cofins, campos.aliquota_cofins) ||
    item.modoCofins;
  const valorUnitario =
    espelho.valorUnitario == null ? item.valorUnitario : Number(espelho.valorUnitario);

  return {
    ...item,
    valorUnitario,
    subtotal: Number((item.quantidade * valorUnitario).toFixed(2)),
    cfop: manter(campos.cfop, item.cfop),
    orig: manter(campos.origem_mercadoria, item.orig),
    csosn: manter(campos.csosn, item.csosn),
    cst: manter(campos.cst, item.cst),
    aliquotaIcms: manter(campos.aliquotaicms, item.aliquotaIcms),
    cstPis: manter(campos.cst_pis, item.cstPis),
    modoPis,
    aliquotaPis: manter(campos.aliquota_pis, item.aliquotaPis),
    cstCofins: manter(campos.cst_cofins, item.cstCofins),
    modoCofins,
    aliquotaCofins: manter(campos.aliquota_cofins, item.aliquotaCofins),
    quantidadePis: modoPis === "QUANTIDADE" ? String(item.quantidade) : item.quantidadePis,
    quantidadeCofins:
      modoCofins === "QUANTIDADE" ? String(item.quantidade) : item.quantidadeCofins,
    procedenciaFiscal: { ...item.procedenciaFiscal, ...(espelho.procedencia ?? {}) },
  };
}

export function toNFeItem(item: AssistedFiscalItem, index = 0): NFeItem {
  const valorTotal = Number((item.quantidade * item.valorUnitario).toFixed(2));
  const valorDesconto = Math.min(Math.max(0, item.valorDesconto || 0), valorTotal);
  // Base dos tributos é o item já líquido do desconto incondicional.
  const valorLiquido = Number((valorTotal - valorDesconto).toFixed(2));
  const buildContribution = (type: "PIS" | "COFINS") => {
    const pis = type === "PIS";
    const modo = pis ? item.modoPis : item.modoCofins;
    if (!modo) return undefined;
    const aliquota = optionalDecimal(pis ? item.aliquotaPis : item.aliquotaCofins);
    const base = optionalDecimal(pis ? item.basePis : item.baseCofins);
    const quantidade = optionalDecimal(pis ? item.quantidadePis : item.quantidadeCofins);
    const aliquotaPorUnidade = optionalDecimal(
      pis ? item.aliquotaPorUnidadePis : item.aliquotaPorUnidadeCofins,
    );
    const valor = optionalDecimal(pis ? item.valorPis : item.valorCofins);
    return {
      cst: pis ? item.cstPis : item.cstCofins,
      modo,
      ...(aliquota !== undefined ? { aliquota } : {}),
      ...(base !== undefined ? { base } : {}),
      ...(quantidade !== undefined ? { quantidade } : {}),
      ...(aliquotaPorUnidade !== undefined ? { aliquotaPorUnidade } : {}),
      ...(valor !== undefined ? { valor } : {}),
    };
  };

  const baseRtc = parseDecimal(item.baseRtc || valorLiquido);
  const aliquotaIbsUf = parseDecimal(item.aliquotaIbsUf);
  const aliquotaIbsMunicipio = parseDecimal(item.aliquotaIbsMunicipio);
  const aliquotaCbs = parseDecimal(item.aliquotaCbs);
  const calc = (base: number, rate: number, informed: string) =>
    informed.trim()
      ? parseDecimal(informed)
      : Number(((base * rate) / 100).toFixed(2));

  return {
    numeroItem: index + 1,
    // cProd usa o id do produto; a referencia continua so na exibicao do item.
    codigoProduto: item.produtoId != null ? String(item.produtoId) : item.codigo,
    // DIFAL: repassa o que o usuário confirmou. O motor só monta o grupo se a
    // operação exigir; estes campos apenas substituem os padrões dele.
    ...(item.difalHabilitado
      ? {
          aliquotaInternaDestino: optionalDecimal(item.difalAliquotaInterna),
          aliquotaInterestadual: optionalDecimal(item.difalAliquotaInterestadual),
          aliquotaFcpDestino: optionalDecimal(item.difalAliquotaFcp),
          percentualPartilhaDestino: optionalDecimal(item.difalPercentualPartilha),
          baseCalculoFcpDestino: optionalDecimal(item.difalBaseFcp),
        }
      : {}),
    descricao: item.descricao,
    ncm: onlyDigits(item.ncm),
    cfop: onlyDigits(item.cfop),
    unidade: item.unidade,
    quantidade: item.quantidade,
    valorUnitario: item.valorUnitario,
    valorTotal,
    valorDesconto,
    orig: item.orig,
    cest: onlyDigits(item.cest) || null,
    csosn: item.csosn || null,
    cst: item.cst || null,
    cstIcms: item.cst || null,
    aliquotaIcms: optionalDecimal(item.aliquotaIcms),
    baseCalculoIcms: item.aliquotaIcms.trim() ? valorLiquido : undefined,
    cstPis: item.cstPis || null,
    aliquotaPis: optionalDecimal(item.aliquotaPis),
    cstCofins: item.cstCofins || null,
    aliquotaCofins: optionalDecimal(item.aliquotaCofins),
    pis: buildContribution("PIS"),
    cofins: buildContribution("COFINS"),
    ...(item.rtcHabilitado
      ? {
          rtc: {
            cstIbsCbs: item.cstIbsCbs,
            cClassTrib: item.cClassTrib,
            baseCalculo: baseRtc,
            ibsUf: {
              aliquota: aliquotaIbsUf,
              valor: calc(baseRtc, aliquotaIbsUf, item.valorIbsUf),
            },
            ibsMunicipio: {
              aliquota: aliquotaIbsMunicipio,
              valor: calc(baseRtc, aliquotaIbsMunicipio, item.valorIbsMunicipio),
            },
            valorIbs: Number(
              (
                calc(baseRtc, aliquotaIbsUf, item.valorIbsUf) +
                calc(baseRtc, aliquotaIbsMunicipio, item.valorIbsMunicipio)
              ).toFixed(2),
            ),
            cbs: {
              aliquota: aliquotaCbs,
              valor: calc(baseRtc, aliquotaCbs, item.valorCbs),
            },
          },
        }
      : {}),
  };
}

export function validateAssistedItem(
  item: AssistedFiscalItem,
  setup: FiscalSetup,
  context?: {
    clienteUf?: string | null;
    parceiroUf?: string | null;
    tipoOperacao?: NFeOperationDirection;
  },
): AssistedItemIssue[] {
  const issues: AssistedItemIssue[] = [];
  if (!item.descricao.trim()) {
    issues.push({ code: "NFE_DESCRIPTION_REQUIRED", field: "descricao", message: "Informe a descrição." });
  }
  if (onlyDigits(item.ncm).length !== 8) {
    issues.push({ code: "NFE_NCM_REQUIRED", field: "ncm", message: "NCM deve ter 8 dígitos." });
  }
  const cfop = onlyDigits(item.cfop);
  if (cfop.length !== 4) {
    issues.push({ code: "NFE_CFOP_REQUIRED", field: "cfop", message: "CFOP deve ter 4 dígitos." });
  }
  if (!setup.unidades.includes(item.unidade)) {
    issues.push({ code: "NFE_UNIT_REQUIRED", field: "unidade", message: "Selecione uma unidade válida." });
  }
  if (item.quantidade <= 0) {
    issues.push({ code: "NFE_QUANTITY_REQUIRED", field: "quantidade", message: "Quantidade deve ser maior que zero." });
  }
  if (item.valorUnitario <= 0) {
    issues.push({ code: "NFE_UNIT_VALUE_REQUIRED", field: "valorUnitario", message: "Valor unitário deve ser maior que zero." });
  }
  if (item.valorDesconto < 0) {
    issues.push({ code: "NFE_DISCOUNT_INVALID", field: "valorDesconto", message: "Desconto não pode ser negativo." });
  }
  if (item.valorDesconto > Number((item.quantidade * item.valorUnitario).toFixed(2))) {
    issues.push({
      code: "NFE_DISCOUNT_ABOVE_ITEM",
      field: "valorDesconto",
      message: "Desconto não pode ser maior que o total do item.",
    });
  }

  const empresaUf = String(setup.empresa?.uf ?? "").toUpperCase();
  const parceiroUf = String(context?.parceiroUf ?? context?.clienteUf ?? "").toUpperCase();
  const tipoOperacao = context?.tipoOperacao ?? "SAIDA";
  if (
    cfop.length === 4 &&
    empresaUf &&
    parceiroUf &&
    !isCfopCompatibleWithOperation(cfop, tipoOperacao, empresaUf, parceiroUf)
  ) {
    const sentido = tipoOperacao === "ENTRADA" ? "entrada" : "saída";
    issues.push({
      code: "NFE_CFOP_DESTINATION_MISMATCH",
      field: "cfop",
      message: `CFOP incompatível com a operação de ${sentido} entre ${empresaUf} e ${parceiroUf}.`,
    });
  }

  const cst = normalizeCode(item.cst, 2);
  const csosn = normalizeCode(item.csosn, 3);
  const st = ["10", "30", "70"].includes(cst) || ["201", "202", "203"].includes(csosn);
  if (st && onlyDigits(item.cest).length !== 7) {
    issues.push({ code: "NFE_CEST_REQUIRED", field: "cest", message: "CEST deve ter 7 dígitos para tributação com ICMS-ST." });
  } else if (item.cest && onlyDigits(item.cest).length !== 7) {
    issues.push({ code: "NFE_CEST_INVALID", field: "cest", message: "CEST deve ter 7 dígitos." });
  }

  const crt = Number(setup.empresa?.crt ?? 0) as CRT;
  if ([1, 2, 3, 4].includes(crt)) {
    const classification = item.rtcHabilitado
      ? setup.classificacoesRtc.find((entry) => entry.codigo === item.cClassTrib) ?? null
      : null;
    issues.push(
      ...validateNFeItemTax(toNFeItem(item), crt, { classificacaoRtc: classification }),
    );
  } else {
    issues.push({ code: "NFE_CRT_REQUIRED", field: "crt", message: "CRT da empresa não está configurado." });
  }

  return issues;
}

/**
 * Redistribui o desconto geral sobre os itens escolhidos para a nota.
 *
 * O peso é o valor do item já líquido do desconto próprio, e a sobra de centavos
 * cai no último — a soma dos vDesc fecha exatamente o valor digitado. Itens fora
 * da nota mantêm o que tinham: só quem está sendo emitido divide o desconto.
 */
export function ratearDescontoGeralNosItens(
  itens: AssistedFiscalItem[],
  descontoGeral: number,
  incluir: (item: AssistedFiscalItem) => boolean = () => true,
): AssistedFiscalItem[] {
  const alvos = itens.filter(incluir);
  if (alvos.length === 0) return itens;

  const linhas = alvos.map((item) => {
    const bruto = Number((item.quantidade * item.valorUnitario).toFixed(2));
    return { bruto, liquido: Math.max(0, bruto - Math.max(0, item.valorDescontoProprio)) };
  });
  const descontos = descontoPorItem(linhas, Math.max(0, descontoGeral));
  const porItem = new Map(alvos.map((item, index) => [item.sourceItemId, descontos[index] ?? 0]));

  return itens.map((item) =>
    porItem.has(item.sourceItemId)
      ? { ...item, valorDesconto: porItem.get(item.sourceItemId)! }
      : item,
  );
}

export function toApiItem(item: AssistedFiscalItem) {
  return {
    sourceItemId: item.sourceItemId,
    produtoId: item.produtoId,
    codigo: item.codigo,
    descricao: item.descricao,
    ncm: item.ncm,
    cfop: item.cfop,
    unidade: item.unidade,
    quantidade: item.quantidade,
    valorUnitario: item.valorUnitario,
    valorDesconto: item.valorDesconto,
    orig: item.orig,
    csosn: item.csosn || null,
    cst: item.cst || null,
    aliquotaIcms: item.aliquotaIcms || null,
    cest: item.cest || null,
    cstPis: item.cstPis || null,
    modoPis: item.modoPis || null,
    aliquotaPis: item.aliquotaPis || null,
    basePis: item.basePis || null,
    quantidadePis: item.quantidadePis || null,
    aliquotaPorUnidadePis: item.aliquotaPorUnidadePis || null,
    valorPis: item.valorPis || null,
    cstCofins: item.cstCofins || null,
    modoCofins: item.modoCofins || null,
    aliquotaCofins: item.aliquotaCofins || null,
    baseCofins: item.baseCofins || null,
    quantidadeCofins: item.quantidadeCofins || null,
    aliquotaPorUnidadeCofins: item.aliquotaPorUnidadeCofins || null,
    valorCofins: item.valorCofins || null,
    rtcHabilitado: item.rtcHabilitado,
    cstIbsCbs: item.cstIbsCbs || null,
    cClassTrib: item.cClassTrib || null,
    baseRtc: item.baseRtc || null,
    aliquotaIbsUf: item.aliquotaIbsUf || null,
    valorIbsUf: item.valorIbsUf || null,
    aliquotaIbsMunicipio: item.aliquotaIbsMunicipio || null,
    valorIbsMunicipio: item.valorIbsMunicipio || null,
    aliquotaCbs: item.aliquotaCbs || null,
    valorCbs: item.valorCbs || null,
    // DIFAL confirmado pelo usuário. Sem isso o servidor recalcularia com os
    // padrões e descartaria o que foi digitado na tela.
    aliquotaInternaDestino: item.difalHabilitado ? item.difalAliquotaInterna || null : null,
    aliquotaInterestadual: item.difalHabilitado ? item.difalAliquotaInterestadual || null : null,
    aliquotaFcpDestino: item.difalHabilitado ? item.difalAliquotaFcp || null : null,
    percentualPartilhaDestino: item.difalHabilitado ? item.difalPercentualPartilha || null : null,
    baseCalculoFcpDestino: item.difalHabilitado ? item.difalBaseFcp || null : null,
    // Não entra no XML: fica no snapshot do item para uma nota antiga poder ser
    // explicada depois — se um campo veio do padrão de Configurações, corrigir
    // o produto não basta, tem de corrigir o padrão.
    procedenciaFiscal: item.procedenciaFiscal,
  };
}
