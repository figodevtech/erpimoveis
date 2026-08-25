/**
 * Leitura fiscal do XML da NF-e: o que compõe o valor total e o que é informativo.
 *
 * O importador de entrada lia seis campos de `ICMSTot` e somava o que achava pela
 * frente. Nota com ICMS-ST, seguro, despesas acessórias ou IPI devolvido chegava
 * com o total errado, as parcelas não fechavam com as duplicatas do fornecedor e
 * o lançamento travava sem dizer por quê.
 *
 * A regra aqui é uma só: `total/ICMSTot/vNF` é o valor fiscal da nota. O cálculo
 * NUNCA o substitui — serve para descobrir a composição, apontar divergência e
 * alimentar a entrada de estoque com números que a gente sabe de onde vieram.
 *
 * O simples fato de um imposto existir no XML não significa que ele se soma ao
 * produto. ICMS próprio, PIS e COFINS normais já estão dentro do preço; FCP,
 * FCP-ST retido, ICMS de partilha e `vTotTrib` são informativos; `vBC*` e
 * `qBCMono*` são bases de cálculo, não dinheiro cobrado. Todos são lidos e
 * guardados, nenhum entra na conta.
 *
 * Dinheiro em centavos inteiros, como manda `src/lib/financeiro/rateio.ts`: em
 * float `0.1 + 0.2 !== 0.3` e um centavo de diferença derruba a conferência.
 */

import { XMLParser } from "fast-xml-parser";

import { paraCentavos, paraReais } from "@/lib/financeiro/rateio";

import {
  TOLERANCIA_EM_CENTAVOS,
  campoDeReferenciaDoTotal,
  ehFaturamentoDiretoDeVeiculoNovo,
  ehImportacao,
  reformaCompoeTotal,
  type RegraDeTotal,
} from "./regras-total";
import { caminho, comoLista, paraNumero, paraTexto, registro } from "./xml-valores";

/* ------------------------------------------------------------------ *
 * Tipos
 * ------------------------------------------------------------------ */

/** Valores que aumentam o total da nota. */
export interface AcrescimosDaNota {
  frete: number;
  seguro: number;
  outrasDespesas: number;
  icmsST: number;
  fcpST: number;
  icmsMonoReten: number;
  impostoImportacao: number;
  ipi: number;
  ipiDevolvido: number;
  servicos: number;
  /** `PISST/vPIS` dos itens com `indSomaPISST = 1`. Só esses compõem o total. */
  pisSTCompoeTotal: number;
  /** `COFINSST/vCOFINS` dos itens com `indSomaCOFINSST = 1`. */
  cofinsSTCompoeTotal: number;
}

/** Valores que reduzem o total da nota. */
export interface ReducoesDaNota {
  desconto: number;
  icmsDesonerado: number;
}

/**
 * Lidos e guardados, nunca somados. Ou já estão embutidos no preço do produto,
 * ou são retenção, partilha ou estimativa de outra regra tributária.
 */
export interface InformativosDaNota {
  icms: number;
  pis: number;
  cofins: number;
  fcp: number;
  fcpSTRet: number;
  icmsUFDest: number;
  fcpUFDest: number;
  icmsUFRemet: number;
  icmsMono: number;
  icmsMonoRet: number;
  totalTributos: number;
  /** Bases de cálculo. Não representam dinheiro adicional cobrado. */
  baseIcms: number;
  baseIcmsST: number;
  quantidadeBaseMono: number;
  quantidadeBaseMonoReten: number;
  quantidadeBaseMonoRet: number;
}

/** Grupos da Reforma Tributária (NT 2025.002). Detectados, não somados na transição. */
export interface ReformaTributariaDaNota {
  is: number;
  ibs: number;
  ibsUF: number;
  ibsMunicipio: number;
  cbs: number;
  totIBSMonoItem: number;
  totCBSMonoItem: number;
  baseIBSCBS: number;
  diferimento: number;
  devolucaoTributos: number;
  presente: boolean;
  /** Falso durante a transição: somar aqui cobraria o imposto duas vezes. */
  compoeTotal: boolean;
}

/** Grupo `retTrib`. Retenção não é acréscimo nem desconto do `vNF`. */
export interface RetencoesDaNota {
  retPIS: number;
  retCOFINS: number;
  retCSLL: number;
  irrf: number;
  retPrev: number;
  baseIRRF: number;
  baseRetPrev: number;
  presente: boolean;
}

/** Grupo `ISSQNtot`. Só `vServ` entra na composição; o resto é detalhamento. */
export interface IssqnDaNota {
  servicos: number;
  baseCalculo: number;
  iss: number;
  pis: number;
  cofins: number;
  deducao: number;
  outro: number;
  descontoIncondicionado: number;
  descontoCondicionado: number;
  issRetido: number;
}

/**
 * Soma dos itens, para conferir com o total. NUNCA somada ao total.
 *
 * O total do XML é a consolidação dos itens, não um segundo acréscimo. Somar os
 * dois cobraria o mesmo tributo duas vezes.
 */
export interface ConferenciaDosItens {
  produtos: number;
  desconto: number;
  frete: number;
  seguro: number;
  outrasDespesas: number;
  ipi: number;
  ipiDevolvido: number;
  icmsST: number;
  fcpST: number;
  icmsMonoReten: number;
  impostoImportacao: number;
  icmsDesonerado: number;
  pisST: number;
  cofinsST: number;
}

export interface TotaisDaNota {
  produtos: number;
  reducoes: ReducoesDaNota;
  acrescimos: AcrescimosDaNota;
  informativos: InformativosDaNota;
  reformaTributaria: ReformaTributariaDaNota;
  retencoes: RetencoesDaNota;
  issqn: IssqnDaNota | null;
  conferenciaDosItens: ConferenciaDosItens;
  indicadores: {
    tpOp: number | null;
    /** Algum item trouxe `indSomaPISST = 1`. */
    somaPisST: boolean;
    somaCofinsST: boolean;
    /** CFOP iniciado em 3: a validação do somatório tem exceção prevista. */
    importacao: boolean;
    veiculoNovo: boolean;
    /** `total/vNFTot`, quando o leiaute trouxer. Reconhecido, não usado. */
    vNFTot: number | null;
  };
  /** `ICMSTot/vNF` — a referência fiscal. Nunca substituída pelo cálculo. */
  totalNota: number;
  totalCalculado: number;
  /** `totalNota − totalCalculado`. Zero quando a composição fecha. */
  diferenca: number;
  composicaoValida: boolean;
  regra: RegraDeTotal;
  /**
   * Importação e faturamento direto de veículo novo têm exceções à validação do
   * somatório. Divergência ali é prevista, não é erro de leitura.
   */
  divergenciaPrevista: boolean;
}

export interface ItemFiscalDaNota {
  numeroItem: number | null;
  codigo: string | null;
  ean: string | null;
  descricao: string | null;
  ncm: string | null;
  cest: string | null;
  cfop: string | null;
  unidade: string | null;
  quantidade: number;
  valorUnitario: number;
  valorProdutos: number;
  /** `indTot`: 0 quer dizer que o item NÃO entra no total da nota. */
  compoeTotal: boolean;
  valorDesconto: number;
  valorFrete: number;
  valorSeguro: number;
  outrasDespesas: number;
  valorIpi: number;
  valorIpiDevolvido: number;
  valorIcmsST: number;
  valorFcpST: number;
  valorIcmsMonoReten: number;
  valorII: number;
  valorIcmsDesonerado: number;
  /**
   * `indDeduzDeson`: 1 quando o desonerado foi deduzido do valor da operação.
   * `null` quando o XML não informou — e aí a dedução não pode ser presumida.
   */
  deduzIcmsDesonerado: boolean | null;
  pisST: { valor: number; compoeTotal: boolean };
  cofinsST: { valor: number; compoeTotal: boolean };
  informativos: {
    icms: number;
    fcp: number;
    fcpSTRet: number;
    pis: number;
    cofins: number;
    icmsMono: number;
    icmsMonoRet: number;
    icmsMonoReten: number;
    totalTributos: number;
  };
  /** Grupo `imposto/ICMS` cru — a tela ainda mostra origem e CSOSN a partir dele. */
  icms: unknown;
}

/* ------------------------------------------------------------------ *
 * Leitura
 * ------------------------------------------------------------------ */

/**
 * Abre o XML e acha o `infNFe`, venha ele como vier.
 *
 * O arquivo chega em três formas: `nfeProc` (com protocolo), `NFe` avulso e — de
 * emissor que recorta o documento — `infNFe` na raiz. `removeNSPrefix` cobre o
 * XML que declara o namespace da NF-e com prefixo (`<nfe:NFe>`), que sem isso
 * caía em "estrutura não reconhecida".
 */
export function lerNFeDoXml(xml: string): {
  documento: Record<string, unknown>;
  infNFe: Record<string, unknown> | null;
} {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
  });

  const documento = (parser.parse(xml) ?? {}) as Record<string, unknown>;

  const infNFe =
    caminho(documento, "nfeProc", "NFe", "infNFe") ??
    caminho(documento, "NFe", "infNFe") ??
    caminho(documento, "infNFe") ??
    null;

  return { documento, infNFe };
}

/** Centavos de um campo do XML, tolerando texto com vírgula, número e ausência. */
function centavos(valor: unknown): number {
  return paraCentavos(paraNumero(valor));
}

/**
 * Soma, em centavos, todas as ocorrências de uma tag dentro de uma subárvore.
 *
 * Os grupos novos (IBS/CBS/IS) mudam de aninhamento entre revisões da Nota
 * Técnica, e o grupo de ICMS do item vem embrulhado num nome diferente para cada
 * CST. Procurar pelo nome da tag em vez do caminho fixo sobrevive aos dois.
 */
function somarProfundo(no: unknown, nome: string): number {
  if (no == null || typeof no !== "object") return 0;

  if (Array.isArray(no)) {
    return no.reduce<number>((total, filho) => total + somarProfundo(filho, nome), 0);
  }

  let total = 0;
  for (const [chave, valor] of Object.entries(no as Record<string, unknown>)) {
    if (chave === nome) {
      const numero = paraNumero(valor);
      if (numero != null) total += paraCentavos(numero);
      continue;
    }
    total += somarProfundo(valor, nome);
  }
  return total;
}

/** Primeira ocorrência de uma tag dentro de uma subárvore, sem somar. */
function buscarProfundo(no: unknown, nome: string): unknown {
  if (no == null || typeof no !== "object") return undefined;

  if (Array.isArray(no)) {
    for (const filho of no) {
      const achado = buscarProfundo(filho, nome);
      if (achado !== undefined) return achado;
    }
    return undefined;
  }

  for (const [chave, valor] of Object.entries(no as Record<string, unknown>)) {
    if (chave === nome) return valor;
    const achado = buscarProfundo(valor, nome);
    if (achado !== undefined) return achado;
  }
  return undefined;
}

/**
 * O grupo de ICMS do item vem embrulhado num nome diferente para cada CST/CSOSN:
 * ICMS00, ICMS10, ICMS15, ICMS30, ICMS51, ICMS60, ICMS61, ICMS70, ICMS90,
 * ICMSST, ICMSPart, ICMSSN101, ICMSSN201, ICMSSN500, ICMSSN900… e os que a
 * próxima Nota Técnica criar.
 *
 * Por isso o filho é descoberto, nunca nomeado no código: `imposto.ICMS.ICMS10`
 * fixo perde o valor em qualquer nota com outro CST — que foi exatamente o tipo
 * de leitura que este módulo veio substituir.
 */
function grupoDeIcms(imposto: Record<string, unknown> | null): unknown {
  const icms = registro(imposto?.ICMS);
  if (!icms) return null;
  for (const valor of Object.values(icms)) {
    if (registro(valor)) return valor;
  }
  return icms;
}

export function lerItensDaNota(infNFe: unknown): ItemFiscalDaNota[] {
  return comoLista(registro(infNFe)?.det)
    .map((no): ItemFiscalDaNota | null => {
      const det = registro(no);
      if (!det) return null;

      const prod = registro(det.prod) ?? {};
      const imposto = registro(det.imposto);
      const icms = grupoDeIcms(imposto);
      const indTot = paraNumero(prod.indTot);

      const pisST = registro(imposto?.PISST);
      const cofinsST = registro(imposto?.COFINSST);

      return {
        numeroItem: paraNumero(det["@_nItem"]),
        codigo: paraTexto(prod.cProd),
        ean: paraTexto(prod.cEAN),
        descricao: paraTexto(prod.xProd),
        ncm: paraTexto(prod.NCM),
        cest: paraTexto(prod.CEST),
        cfop: paraTexto(prod.CFOP),
        unidade: paraTexto(prod.uCom),
        quantidade: paraNumero(prod.qCom) ?? 0,
        valorUnitario: paraNumero(prod.vUnCom) ?? 0,
        valorProdutos: paraReais(centavos(prod.vProd)),
        // Ausente vale 1: a especificação só exige `indTot` para dizer que NÃO soma.
        compoeTotal: indTot == null || indTot === 1,
        valorDesconto: paraReais(centavos(prod.vDesc)),
        valorFrete: paraReais(centavos(prod.vFrete)),
        valorSeguro: paraReais(centavos(prod.vSeg)),
        outrasDespesas: paraReais(centavos(prod.vOutro)),
        valorIpi: paraReais(somarProfundo(imposto?.IPI, "vIPI")),
        valorIpiDevolvido: paraReais(somarProfundo(det.impostoDevol, "vIPIDevol")),
        valorIcmsST: paraReais(somarProfundo(icms, "vICMSST")),
        valorFcpST: paraReais(somarProfundo(icms, "vFCPST")),
        valorIcmsMonoReten: paraReais(somarProfundo(icms, "vICMSMonoReten")),
        valorII: paraReais(somarProfundo(imposto?.II, "vII")),
        valorIcmsDesonerado: paraReais(somarProfundo(icms, "vICMSDeson")),
        deduzIcmsDesonerado: (() => {
          const indicador = paraNumero(buscarProfundo(icms, "indDeduzDeson"));
          return indicador == null ? null : indicador === 1;
        })(),
        pisST: {
          valor: paraReais(centavos(pisST?.vPIS)),
          compoeTotal: paraNumero(pisST?.indSomaPISST) === 1,
        },
        cofinsST: {
          valor: paraReais(centavos(cofinsST?.vCOFINS)),
          compoeTotal: paraNumero(cofinsST?.indSomaCOFINSST) === 1,
        },
        informativos: {
          icms: paraReais(somarProfundo(icms, "vICMS")),
          fcp: paraReais(somarProfundo(icms, "vFCP")),
          fcpSTRet: paraReais(somarProfundo(icms, "vFCPSTRet")),
          pis: paraReais(somarProfundo(imposto?.PIS, "vPIS")),
          cofins: paraReais(somarProfundo(imposto?.COFINS, "vCOFINS")),
          icmsMono: paraReais(somarProfundo(icms, "vICMSMono")),
          icmsMonoRet: paraReais(somarProfundo(icms, "vICMSMonoRet")),
          icmsMonoReten: paraReais(somarProfundo(icms, "vICMSMonoReten")),
          totalTributos: paraReais(centavos(imposto?.vTotTrib)),
        },
        icms: registro(imposto?.ICMS) ?? null,
      };
    })
    .filter((item): item is ItemFiscalDaNota => item != null);
}

function lerIssqn(total: Record<string, unknown> | null): IssqnDaNota | null {
  const issqn = registro(total?.ISSQNtot);
  if (!issqn) return null;

  return {
    servicos: paraReais(centavos(issqn.vServ)),
    baseCalculo: paraReais(centavos(issqn.vBC)),
    iss: paraReais(centavos(issqn.vISS)),
    pis: paraReais(centavos(issqn.vPIS)),
    cofins: paraReais(centavos(issqn.vCOFINS)),
    deducao: paraReais(centavos(issqn.vDeducao)),
    outro: paraReais(centavos(issqn.vOutro)),
    descontoIncondicionado: paraReais(centavos(issqn.vDescIncond)),
    descontoCondicionado: paraReais(centavos(issqn.vDescCond)),
    issRetido: paraReais(centavos(issqn.vISSRet)),
  };
}

function lerRetencoes(total: Record<string, unknown> | null): RetencoesDaNota {
  const ret = registro(total?.retTrib);
  return {
    retPIS: paraReais(centavos(ret?.vRetPIS)),
    retCOFINS: paraReais(centavos(ret?.vRetCOFINS)),
    retCSLL: paraReais(centavos(ret?.vRetCSLL)),
    irrf: paraReais(centavos(ret?.vIRRF)),
    retPrev: paraReais(centavos(ret?.vRetPrev)),
    baseIRRF: paraReais(centavos(ret?.vBCIRRF)),
    baseRetPrev: paraReais(centavos(ret?.vBCRetPrev)),
    presente: ret != null,
  };
}

function lerReforma(
  total: Record<string, unknown> | null,
  compoeTotal: boolean,
): ReformaTributariaDaNota {
  const isTot = registro(total?.ISTot);
  const ibsCbsTot = registro(total?.IBSCBSTot);

  return {
    is: paraReais(somarProfundo(isTot, "vIS")),
    ibs: paraReais(somarProfundo(ibsCbsTot, "vIBS")),
    ibsUF: paraReais(somarProfundo(ibsCbsTot, "vIBSUF")),
    ibsMunicipio: paraReais(somarProfundo(ibsCbsTot, "vIBSMun")),
    cbs: paraReais(somarProfundo(ibsCbsTot, "vCBS")),
    totIBSMonoItem: paraReais(somarProfundo(ibsCbsTot, "vTotIBSMonoItem")),
    totCBSMonoItem: paraReais(somarProfundo(ibsCbsTot, "vTotCBSMonoItem")),
    baseIBSCBS: paraReais(somarProfundo(ibsCbsTot, "vBCIBSCBS")),
    diferimento: paraReais(
      somarProfundo(isTot, "vDif") + somarProfundo(ibsCbsTot, "vDif"),
    ),
    devolucaoTributos: paraReais(
      somarProfundo(isTot, "vDevTrib") + somarProfundo(ibsCbsTot, "vDevTrib"),
    ),
    presente: isTot != null || ibsCbsTot != null,
    compoeTotal,
  };
}

function conferirItens(itens: ItemFiscalDaNota[]): ConferenciaDosItens {
  const soma = (escolher: (item: ItemFiscalDaNota) => number) =>
    paraReais(itens.reduce((total, item) => total + paraCentavos(escolher(item)), 0));

  return {
    // Só o que a nota diz que compõe o total. `indTot = 0` fica de fora.
    produtos: paraReais(
      itens.reduce(
        (total, item) =>
          total + (item.compoeTotal ? paraCentavos(item.valorProdutos) : 0),
        0,
      ),
    ),
    desconto: soma((item) => item.valorDesconto),
    frete: soma((item) => item.valorFrete),
    seguro: soma((item) => item.valorSeguro),
    outrasDespesas: soma((item) => item.outrasDespesas),
    ipi: soma((item) => item.valorIpi),
    ipiDevolvido: soma((item) => item.valorIpiDevolvido),
    icmsST: soma((item) => item.valorIcmsST),
    fcpST: soma((item) => item.valorFcpST),
    icmsMonoReten: soma((item) => item.valorIcmsMonoReten),
    impostoImportacao: soma((item) => item.valorII),
    icmsDesonerado: soma((item) => item.valorIcmsDesonerado),
    // PIS-ST e COFINS-ST só existem no item; a soma é a do que compõe o total.
    pisST: soma((item) => (item.pisST.compoeTotal ? item.pisST.valor : 0)),
    cofinsST: soma((item) => (item.cofinsST.compoeTotal ? item.cofinsST.valor : 0)),
  };
}

/* ------------------------------------------------------------------ *
 * Reconciliação
 * ------------------------------------------------------------------ */

type Candidato = { regra: RegraDeTotal; centavos: number };

/**
 * As composições possíveis, em ordem de preferência.
 *
 * A primeira que bater com o `vNF` (dentro de um centavo) é a regra da nota. Se
 * nenhuma bater, vale a primeira da lista e a diferença fica registrada — nada é
 * alterado em silêncio.
 */
function montarCandidatos(entrada: {
  produtosEmCentavos: number;
  descontoEmCentavos: number;
  desoneracaoEmCentavos: number;
  acrescimosEmCentavos: number;
  stEmCentavos: number;
  fcpSTEmCentavos: number;
  ipiDevolvidoEmCentavos: number;
  veiculoNovo: boolean;
}): Candidato[] {
  const base =
    entrada.produtosEmCentavos -
    entrada.descontoEmCentavos +
    entrada.acrescimosEmCentavos;

  const classicas: Candidato[] = [
    { regra: "CLASSICA", centavos: base - entrada.desoneracaoEmCentavos },
    { regra: "CLASSICA_SEM_DESONERACAO", centavos: base },
  ];

  if (!entrada.veiculoNovo) return classicas;

  // Faturamento direto: ST, FCP-ST e IPI devolvido são informados mas não entram
  // no total da nota da montadora. As clássicas continuam na lista porque nem
  // todo emissor de `tpOp = 2` usa a exceção.
  const semST = base - entrada.stEmCentavos - entrada.fcpSTEmCentavos;
  return [
    { regra: "VEICULO_NOVO", centavos: semST - entrada.desoneracaoEmCentavos },
    {
      regra: "VEICULO_NOVO_SEM_IPI_DEVOLVIDO",
      centavos:
        semST - entrada.desoneracaoEmCentavos - entrada.ipiDevolvidoEmCentavos,
    },
    ...classicas,
  ];
}

export function lerTotaisDaNota(infNFe: unknown): TotaisDaNota {
  const raiz = registro(infNFe);
  const ide = registro(raiz?.ide);
  const total = registro(raiz?.total);
  const icmsTot = caminho(raiz, "total", "ICMSTot") ?? {};

  const itens = lerItensDaNota(infNFe);
  const conferenciaDosItens = conferirItens(itens);

  const dataEmissao = paraTexto(ide?.dhEmi ?? ide?.dEmi);
  const versaoLeiaute = paraTexto(raiz?.["@_versao"]);
  const tpOp = paraNumero(ide?.tpOp);
  const veiculoNovo = ehFaturamentoDiretoDeVeiculoNovo(tpOp);
  const importacao = ehImportacao(itens.map((item) => item.cfop));

  const issqn = lerIssqn(total);
  const reformaTributaria = lerReforma(
    total,
    reformaCompoeTotal({ dataEmissao, versaoLeiaute }),
  );
  const retencoes = lerRetencoes(total);

  // PIS-ST e COFINS-ST não existem em `ICMSTot`: o único lugar onde aparecem é o
  // item, e só compõem o total quando o próprio XML manda somar.
  const pisSTEmCentavos = itens.reduce(
    (soma, item) => soma + (item.pisST.compoeTotal ? paraCentavos(item.pisST.valor) : 0),
    0,
  );
  const cofinsSTEmCentavos = itens.reduce(
    (soma, item) =>
      soma + (item.cofinsST.compoeTotal ? paraCentavos(item.cofinsST.valor) : 0),
    0,
  );

  const produtosEmCentavos = centavos(icmsTot.vProd);
  const descontoEmCentavos = centavos(icmsTot.vDesc);
  const desoneracaoEmCentavos = centavos(icmsTot.vICMSDeson);
  const stEmCentavos = centavos(icmsTot.vST);
  const fcpSTEmCentavos = centavos(icmsTot.vFCPST);
  const ipiDevolvidoEmCentavos = centavos(icmsTot.vIPIDevol);
  const servicosEmCentavos = paraCentavos(issqn?.servicos ?? 0);

  const acrescimosEmCentavos =
    centavos(icmsTot.vFrete) +
    centavos(icmsTot.vSeg) +
    centavos(icmsTot.vOutro) +
    stEmCentavos +
    fcpSTEmCentavos +
    centavos(icmsTot.vICMSMonoReten) +
    centavos(icmsTot.vII) +
    centavos(icmsTot.vIPI) +
    ipiDevolvidoEmCentavos +
    servicosEmCentavos +
    pisSTEmCentavos +
    cofinsSTEmCentavos;

  // `vNFTot` é reconhecido e guardado; trocar a referência por ele depende da
  // regra vigente, não da presença do campo no XML.
  const vNFTot = paraNumero(total?.vNFTot);
  const campoDeReferencia = campoDeReferenciaDoTotal({
    dataEmissao,
    versaoLeiaute,
    temVNFTot: vNFTot != null,
  });
  const totalNotaEmCentavos =
    campoDeReferencia === "vNFTot" ? paraCentavos(vNFTot) : centavos(icmsTot.vNF);

  const candidatos = montarCandidatos({
    produtosEmCentavos,
    descontoEmCentavos,
    desoneracaoEmCentavos,
    acrescimosEmCentavos,
    stEmCentavos,
    fcpSTEmCentavos,
    ipiDevolvidoEmCentavos,
    veiculoNovo,
  });

  const vencedor = candidatos.find(
    (candidato) =>
      Math.abs(totalNotaEmCentavos - candidato.centavos) <= TOLERANCIA_EM_CENTAVOS,
  );
  const escolhido = vencedor ?? candidatos[0];

  return {
    produtos: paraReais(produtosEmCentavos),
    reducoes: {
      desconto: paraReais(descontoEmCentavos),
      icmsDesonerado: paraReais(desoneracaoEmCentavos),
    },
    acrescimos: {
      frete: paraReais(centavos(icmsTot.vFrete)),
      seguro: paraReais(centavos(icmsTot.vSeg)),
      outrasDespesas: paraReais(centavos(icmsTot.vOutro)),
      icmsST: paraReais(stEmCentavos),
      fcpST: paraReais(fcpSTEmCentavos),
      icmsMonoReten: paraReais(centavos(icmsTot.vICMSMonoReten)),
      impostoImportacao: paraReais(centavos(icmsTot.vII)),
      ipi: paraReais(centavos(icmsTot.vIPI)),
      ipiDevolvido: paraReais(ipiDevolvidoEmCentavos),
      servicos: paraReais(servicosEmCentavos),
      pisSTCompoeTotal: paraReais(pisSTEmCentavos),
      cofinsSTCompoeTotal: paraReais(cofinsSTEmCentavos),
    },
    informativos: {
      icms: paraReais(centavos(icmsTot.vICMS)),
      pis: paraReais(centavos(icmsTot.vPIS)),
      cofins: paraReais(centavos(icmsTot.vCOFINS)),
      fcp: paraReais(centavos(icmsTot.vFCP)),
      fcpSTRet: paraReais(centavos(icmsTot.vFCPSTRet)),
      icmsUFDest: paraReais(centavos(icmsTot.vICMSUFDest)),
      fcpUFDest: paraReais(centavos(icmsTot.vFCPUFDest)),
      icmsUFRemet: paraReais(centavos(icmsTot.vICMSUFRemet)),
      icmsMono: paraReais(centavos(icmsTot.vICMSMono)),
      icmsMonoRet: paraReais(centavos(icmsTot.vICMSMonoRet)),
      totalTributos: paraReais(centavos(icmsTot.vTotTrib)),
      baseIcms: paraReais(centavos(icmsTot.vBC)),
      baseIcmsST: paraReais(centavos(icmsTot.vBCST)),
      quantidadeBaseMono: paraNumero(icmsTot.qBCMono) ?? 0,
      quantidadeBaseMonoReten: paraNumero(icmsTot.qBCMonoReten) ?? 0,
      quantidadeBaseMonoRet: paraNumero(icmsTot.qBCMonoRet) ?? 0,
    },
    reformaTributaria,
    retencoes,
    issqn,
    conferenciaDosItens,
    indicadores: {
      tpOp,
      somaPisST: itens.some((item) => item.pisST.compoeTotal),
      somaCofinsST: itens.some((item) => item.cofinsST.compoeTotal),
      importacao,
      veiculoNovo,
      vNFTot,
    },
    totalNota: paraReais(totalNotaEmCentavos),
    totalCalculado: paraReais(escolhido.centavos),
    diferenca: paraReais(totalNotaEmCentavos - escolhido.centavos),
    composicaoValida: vencedor != null,
    regra: escolhido.regra,
    divergenciaPrevista: vencedor == null && (importacao || veiculoNovo),
  };
}

/**
 * O que a regra escolhida realmente somou, na ordem em que se lê uma nota.
 *
 * Sai daqui, e não de uma lista fixa de campos, porque a regra muda o conjunto:
 * no faturamento direto de veículo novo o ST está no XML mas fora do total, e
 * mostrá-lo como acréscimo faria a tela mentir sobre o que se paga.
 */
export function componentesDoTotal(totais: TotaisDaNota) {
  const veiculoNovo =
    totais.regra === "VEICULO_NOVO" || totais.regra === "VEICULO_NOVO_SEM_IPI_DEVOLVIDO";
  const semSubstituicao = veiculoNovo;
  const semIpiDevolvido = totais.regra === "VEICULO_NOVO_SEM_IPI_DEVOLVIDO";
  const semDesoneracao = totais.regra === "CLASSICA_SEM_DESONERACAO";

  return {
    produtos: totais.produtos,
    desconto: totais.reducoes.desconto,
    icmsDesonerado: semDesoneracao ? 0 : totais.reducoes.icmsDesonerado,
    frete: totais.acrescimos.frete,
    seguro: totais.acrescimos.seguro,
    outrasDespesas: totais.acrescimos.outrasDespesas,
    icmsST: semSubstituicao ? 0 : totais.acrescimos.icmsST,
    fcpST: semSubstituicao ? 0 : totais.acrescimos.fcpST,
    icmsMonoReten: totais.acrescimos.icmsMonoReten,
    impostoImportacao: totais.acrescimos.impostoImportacao,
    ipi: totais.acrescimos.ipi,
    ipiDevolvido: semIpiDevolvido ? 0 : totais.acrescimos.ipiDevolvido,
    servicos: totais.acrescimos.servicos,
    pisST: totais.acrescimos.pisSTCompoeTotal,
    cofinsST: totais.acrescimos.cofinsSTCompoeTotal,
  };
}

/* ------------------------------------------------------------------ *
 * Alocação por item
 *
 * Três coisas diferentes que este módulo mantém separadas de propósito:
 *
 *   1. COMPOSIÇÃO DO vNF   — o que aumenta ou reduz `ICMSTot/vNF`.
 *   2. ALOCAÇÃO POR ITEM   — em qual `<det>` cada valor foi informado.
 *   3. CUSTO DE ESTOQUE    — o que o ERP incorpora ao preço de compra.
 *
 * Confundir (2) com (3) foi o defeito que este bloco corrige: um tributo estar
 * fora da fórmula de custo da linha NÃO quer dizer que o emitente não o repartiu
 * entre os itens. Na maioria das notas ele está lá, dentro de `det/imposto`.
 * ------------------------------------------------------------------ */

export type StatusDeAlocacao =
  /** O total bate com a soma dos itens: cada centavo tem dono. */
  | "TOTALMENTE_ALOCADO"
  /** Parte do total foi encontrada nos itens, parte não. */
  | "PARCIALMENTE_ALOCADO"
  /** O total traz valor, e nenhum item o informou. */
  | "SEM_ALOCACAO"
  /** Os itens somam mais que o total — leitura ou XML inconsistente. */
  | "EXCEDE_O_TOTAL"
  /** O campo não existe nesta nota. */
  | "AUSENTE";

export interface AlocacaoDeCampo {
  /** A tag do leiaute, para o diagnóstico ficar rastreável ao XML. */
  campo: string;
  rotulo: string;
  totalDaNota: number;
  somaDosItens: number;
  /** `totalDaNota − somaDosItens`. Zero quando tudo tem dono. */
  naoAlocado: number;
  status: StatusDeAlocacao;
}

const CAMPOS_RECONCILIADOS = [
  ["vProd", "Produtos", "produtos", "produtos"],
  ["vDesc", "Desconto", "desconto", "desconto"],
  ["vFrete", "Frete", "frete", "frete"],
  ["vSeg", "Seguro", "seguro", "seguro"],
  ["vOutro", "Outras despesas", "outrasDespesas", "outrasDespesas"],
  ["vST", "ICMS-ST", "icmsST", "icmsST"],
  ["vFCPST", "FCP-ST", "fcpST", "fcpST"],
  ["vICMSMonoReten", "ICMS mono. retido", "icmsMonoReten", "icmsMonoReten"],
  ["vICMSDeson", "ICMS desonerado", "icmsDesonerado", "icmsDesonerado"],
  ["vII", "Imposto de importação", "impostoImportacao", "impostoImportacao"],
  ["vIPI", "IPI", "ipi", "ipi"],
  ["vIPIDevol", "IPI devolvido", "ipiDevolvido", "ipiDevolvido"],
  ["PISST/vPIS", "PIS-ST", "pisST", "pisST"],
  ["COFINSST/vCOFINS", "COFINS-ST", "cofinsST", "cofinsST"],
] as const satisfies ReadonlyArray<
  readonly [
    string,
    string,
    keyof ReturnType<typeof componentesDoTotal>,
    keyof ConferenciaDosItens,
  ]
>;

/**
 * Confronta, campo a campo, o total da NF-e com a soma dos itens.
 *
 * Só depois desta comparação é possível dizer que um valor existe apenas no
 * total. Antes dela, "não achei em `det/prod`" não significa nada: ICMS-ST,
 * FCP-ST, II, IPI, PIS-ST e COFINS-ST moram em `det/imposto`, e o IPI devolvido
 * em `det/impostoDevol`.
 */
export function alocacaoPorItem(totais: TotaisDaNota): AlocacaoDeCampo[] {
  const componentes = componentesDoTotal(totais);

  return CAMPOS_RECONCILIADOS.map(([campo, rotulo, chaveTotal, chaveItens]) => {
    const totalEmCentavos = paraCentavos(componentes[chaveTotal]);
    const itensEmCentavos = paraCentavos(totais.conferenciaDosItens[chaveItens]);
    const naoAlocado = totalEmCentavos - itensEmCentavos;

    const status: StatusDeAlocacao =
      totalEmCentavos === 0 && itensEmCentavos === 0
        ? "AUSENTE"
        : Math.abs(naoAlocado) <= TOLERANCIA_EM_CENTAVOS
          ? "TOTALMENTE_ALOCADO"
          : naoAlocado < 0
            ? "EXCEDE_O_TOTAL"
            : itensEmCentavos === 0
              ? "SEM_ALOCACAO"
              : "PARCIALMENTE_ALOCADO";

    return {
      campo,
      rotulo,
      totalDaNota: paraReais(totalEmCentavos),
      somaDosItens: paraReais(itensEmCentavos),
      naoAlocado: paraReais(naoAlocado),
      status,
    };
  });
}

/**
 * Só os campos cujo valor do total não foi encontrado nos itens.
 *
 * É o que a tela mostra como "valores da NF-e sem alocação por item" — e a
 * legenda para no que o XML de fato diz. Se esse valor deve ou não integrar o
 * custo é outra pergunta, respondida pela regra de custo do ERP.
 */
export function valoresSemAlocacaoPorItem(totais: TotaisDaNota): AlocacaoDeCampo[] {
  return alocacaoPorItem(totais).filter(
    (campo) => campo.status === "SEM_ALOCACAO" || campo.status === "PARCIALMENTE_ALOCADO",
  );
}

export interface ComponenteForaDoCusto {
  campo: string;
  rotulo: string;
  valor: number;
  redutor: boolean;
  /** Quanto deste componente os itens informaram — pode ser tudo. */
  alocadoNosItens: number;
  /** Quanto só apareceu no total, sem `<det>` correspondente. */
  semAlocacao: number;
}

/**
 * A distância entre o custo das linhas e o valor da NF-e, componente a componente.
 *
 * Isto é uma afirmação sobre a REGRA DE CUSTO DO ERP, não sobre a estrutura do
 * XML. Hoje o custo de entrada de cada linha é `quantidade × unitário − desconto
 * + frete + seguro + outras despesas + IPI`, tudo da própria linha — é o que as
 * RPCs de entrada gravam. Os demais componentes do `vNF` ficam de fora dessa
 * fórmula, e é por isso que "a destinar" e "a pagar" diferem.
 *
 * `alocadoNosItens` existe justamente para a tela não repetir o erro de dizer que
 * "o emitente não repartiu": um ICMS-ST informado no item 2 está perfeitamente
 * alocado, só não entra na conta de custo. Quem decide se ele deveria entrar é a
 * regra fiscal da empresa (recuperável ou não), não este módulo.
 *
 * A conta fecha: `custo das linhas + acréscimos − reduções = vNF`, sempre que a
 * composição fecha. Um número que não fecha com nada não explica nada.
 */
export function componentesForaDoCustoDaLinha(totais: TotaisDaNota) {
  const componentes = componentesDoTotal(totais);
  const alocacao = new Map(alocacaoPorItem(totais).map((campo) => [campo.campo, campo]));

  const monta = (
    campo: string,
    rotulo: string,
    valorEmCentavos: number,
    redutor: boolean,
  ): ComponenteForaDoCusto => {
    const encontrado = alocacao.get(campo);
    const semAlocacao = Math.max(0, paraCentavos(encontrado?.naoAlocado ?? 0));
    return {
      campo,
      rotulo,
      valor: paraReais(valorEmCentavos),
      redutor,
      alocadoNosItens: paraReais(Math.max(0, valorEmCentavos - semAlocacao)),
      semAlocacao: paraReais(Math.min(semAlocacao, valorEmCentavos)),
    };
  };

  // Frete, seguro, outras despesas, IPI e desconto JÁ entram no custo da linha
  // pela própria linha. Aqui só sobra a parte que o total declarou a mais.
  const sobra = (doTotal: number, dosItens: number) =>
    Math.max(0, paraCentavos(doTotal) - paraCentavos(dosItens));
  const itens = totais.conferenciaDosItens;

  const acrescimos: ComponenteForaDoCusto[] = [
    monta("vFrete", "Frete", sobra(componentes.frete, itens.frete), false),
    monta("vSeg", "Seguro", sobra(componentes.seguro, itens.seguro), false),
    monta(
      "vOutro",
      "Outras despesas",
      sobra(componentes.outrasDespesas, itens.outrasDespesas),
      false,
    ),
    monta("vIPI", "IPI", sobra(componentes.ipi, itens.ipi), false),
    // Estes a fórmula de custo da linha não usa em nenhuma hipótese, estejam eles
    // alocados a um item ou não.
    monta("vST", "ICMS-ST", paraCentavos(componentes.icmsST), false),
    monta("vFCPST", "FCP-ST", paraCentavos(componentes.fcpST), false),
    monta(
      "vICMSMonoReten",
      "ICMS mono. retido",
      paraCentavos(componentes.icmsMonoReten),
      false,
    ),
    monta(
      "vII",
      "Imposto de importação",
      paraCentavos(componentes.impostoImportacao),
      false,
    ),
    monta("vIPIDevol", "IPI devolvido", paraCentavos(componentes.ipiDevolvido), false),
    monta("ISSQNtot/vServ", "Serviços", paraCentavos(componentes.servicos), false),
    monta("PISST/vPIS", "PIS-ST", paraCentavos(componentes.pisST), false),
    monta("COFINSST/vCOFINS", "COFINS-ST", paraCentavos(componentes.cofinsST), false),
  ];

  const reducoes: ComponenteForaDoCusto[] = [
    monta("vDesc", "Desconto", sobra(componentes.desconto, itens.desconto), true),
    monta(
      "vICMSDeson",
      "ICMS desonerado",
      paraCentavos(componentes.icmsDesonerado),
      true,
    ),
  ];

  const somar = (lista: ComponenteForaDoCusto[]) =>
    lista.reduce((total, parte) => total + paraCentavos(parte.valor), 0);
  const totalEmCentavos = somar(acrescimos) - somar(reducoes);

  return {
    acrescimos: acrescimos.filter((parte) => parte.valor > 0),
    reducoes: reducoes.filter((parte) => parte.valor > 0),
    totalEmCentavos,
    total: paraReais(totalEmCentavos),
  };
}
