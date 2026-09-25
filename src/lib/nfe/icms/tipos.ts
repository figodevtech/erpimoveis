// Tipos do núcleo de ICMS da NF-e.
//
// O núcleo recebe a classificação que o usuário escolheu (CRT, CST/CSOSN e os
// campos que ele informou) e devolve uma única representação do grupo ICMS do
// item. XML, totais, `nfe_item`, prévia e DANFE leem essa mesma representação:
// nenhum deles recalcula ICMS por conta própria.

import type { CRT } from '../types';
import type { ComposicaoBaseIcms } from './baseCalculo';

/** Grupo do ICMS no leiaute 4.00 (PL_010). */
export type GrupoIcmsXml =
  | 'ICMS00'
  | 'ICMS10'
  | 'ICMS20'
  | 'ICMS30'
  | 'ICMS40'
  | 'ICMS51'
  | 'ICMS60'
  | 'ICMS70'
  | 'ICMS90'
  | 'ICMSSN101'
  | 'ICMSSN102'
  | 'ICMSSN201'
  | 'ICMSSN202'
  | 'ICMSSN500'
  | 'ICMSSN900';

/**
 * Blocos do grupo ICMS. No XSD cada um é uma sequência que entra inteira ou
 * não entra — por isso o núcleo decide bloco a bloco, e não campo a campo.
 */
export type BlocoIcms =
  /** modBC, vBC, pICMS, vICMS: ICMS próprio da operação. */
  | 'proprio'
  /** pRedBC: redução da base do ICMS próprio. */
  | 'reducaoBase'
  /** vBCFCP, pFCP, vFCP (no ICMS00, só pFCP e vFCP). */
  | 'fcp'
  /** vICMSOp, pDif, vICMSDif. */
  | 'diferimento'
  /** modBCST, pMVAST, pRedBCST, vBCST, pICMSST, vICMSST: ST retida nesta operação. */
  | 'st'
  /** vBCFCPST, pFCPST, vFCPST. */
  | 'fcpSt'
  /** vBCSTRet, pST, vICMSSubstituto, vICMSSTRet: ST cobrada em operação anterior. */
  | 'stRetida'
  /** vBCFCPSTRet, pFCPSTRet, vFCPSTRet. */
  | 'fcpStRetido'
  /** pRedBCEfet, vBCEfet, pICMSEfet, vICMSEfet. */
  | 'icmsEfetivo'
  /** vICMSDeson, motDesICMS. */
  | 'desoneracao'
  /** pCredSN, vCredICMSSN. */
  | 'creditoSn';

export type RegraBloco = 'OBRIGATORIO' | 'OPCIONAL' | 'PROIBIDO';

/** O que o código escolhido diz sobre a operação, em palavras de negócio. */
export type NaturezaIcms =
  | 'TRIBUTADA_INTEGRALMENTE'
  | 'TRIBUTADA_COM_ST'
  | 'BASE_REDUZIDA'
  | 'ISENTA_OU_NAO_TRIBUTADA_COM_ST'
  | 'ISENTA'
  | 'NAO_TRIBUTADA'
  | 'SUSPENSAO'
  | 'DIFERIMENTO'
  | 'ST_RETIDA_ANTERIORMENTE'
  | 'BASE_REDUZIDA_COM_ST'
  | 'OUTRAS'
  | 'SN_COM_CREDITO'
  | 'SN_SEM_CREDITO'
  | 'SN_ISENCAO_FAIXA'
  | 'SN_COM_CREDITO_E_ST'
  | 'SN_SEM_CREDITO_COM_ST'
  | 'SN_ISENCAO_FAIXA_COM_ST'
  | 'SN_IMUNE'
  | 'SN_NAO_TRIBUTADA'
  | 'SN_ST_RETIDA_ANTERIORMENTE'
  | 'SN_OUTRAS';

export type TratamentoIcms = {
  regime: 'NORMAL' | 'SIMPLES';
  /** CST com 2 dígitos (CRT 2 e 3) ou CSOSN com 3 dígitos (CRT 1 e 4). */
  codigo: string;
  grupoXml: GrupoIcmsXml;
  natureza: NaturezaIcms;
  descricao: string;
  blocos: Record<BlocoIcms, RegraBloco>;
};

/**
 * Representação canônica do grupo ICMS de um item: exatamente os valores que
 * vão para o XML. `null` significa "o grupo não tem esse campo nesta nota".
 */
export type IcmsCanonico = {
  grupoXml: GrupoIcmsXml;
  orig: string;
  cst: string | null;
  csosn: string | null;
  modBC: string | null;
  pRedBC: number | null;
  vBC: number | null;
  pICMS: number | null;
  vICMS: number | null;
  vBCFCP: number | null;
  pFCP: number | null;
  vFCP: number | null;
  vICMSOp: number | null;
  pDif: number | null;
  vICMSDif: number | null;
  modBCST: string | null;
  pMVAST: number | null;
  pRedBCST: number | null;
  vBCST: number | null;
  pICMSST: number | null;
  vICMSST: number | null;
  vBCFCPST: number | null;
  pFCPST: number | null;
  vFCPST: number | null;
  vBCSTRet: number | null;
  pST: number | null;
  vICMSSubstituto: number | null;
  vICMSSTRet: number | null;
  vBCFCPSTRet: number | null;
  pFCPSTRet: number | null;
  vFCPSTRet: number | null;
  pRedBCEfet: number | null;
  vBCEfet: number | null;
  pICMSEfet: number | null;
  vICMSEfet: number | null;
  vICMSDeson: number | null;
  motDesICMS: string | null;
  pCredSN: number | null;
  vCredICMSSN: number | null;
};

type Numero = number | string | null | undefined;

/**
 * Campos de ICMS que a emissão informou explicitamente, bloco a bloco.
 *
 * A alíquota da classificação (`aliquotaIcms`) fica fora dos blocos de
 * propósito: ela é dado do cadastro e só vira pICMS quando o grupo escolhido
 * tem ICMS próprio. Base, valor e redução, ao contrário, são decisão da emissão —
 * informá-los num grupo que não os aceita é erro, não detalhe a descartar.
 */
export type EntradaIcms = {
  crt: CRT;
  cst?: string | null;
  csosn?: string | null;
  orig?: string | number | null;
  /** Valor da operação: item líquido do desconto incondicional. */
  valorOperacao: number;
  /**
   * O que mais compõe a base: frete do item cobrado na nota, seguro e outras
   * despesas. `freteIntegraBaseIcms` já vem decidido (`freteNaBaseIcms`): com
   * frete e sem decisão, o núcleo recusa calcular ICMS próprio ou ST.
   */
  composicaoBase?: {
    frete?: Numero;
    freteIntegraBaseIcms?: boolean | null;
    seguro?: Numero;
    outrasDespesas?: Numero;
  } | null;
  aliquotaIcms?: Numero;
  /** De onde veio a alíquota ('PRODUTO', 'PADRAO', 'MANUAL'...). Só para auditoria. */
  procedenciaAliquota?: string | null;
  proprio?: {
    /** CST 51, 90 e CSOSN 900: o ICMS próprio só é destacado quando o usuário pede. */
    destacar?: boolean | null;
    modBC?: string | number | null;
    vBC?: Numero;
    pRedBC?: Numero;
    vICMS?: Numero;
  } | null;
  fcp?: { pFCP?: Numero; vFCP?: Numero } | null;
  diferimento?: { pDif?: Numero } | null;
  st?: {
    modBCST?: string | number | null;
    pMVAST?: Numero;
    pRedBCST?: Numero;
    vBCST?: Numero;
    pICMSST?: Numero;
    vICMSST?: Numero;
  } | null;
  fcpSt?: { vBCFCPST?: Numero; pFCPST?: Numero; vFCPST?: Numero } | null;
  stRetida?: {
    vBCSTRet?: Numero;
    pST?: Numero;
    vICMSSubstituto?: Numero;
    vICMSSTRet?: Numero;
  } | null;
  fcpStRetido?: { vBCFCPSTRet?: Numero; pFCPSTRet?: Numero; vFCPSTRet?: Numero } | null;
  icmsEfetivo?: { pRedBCEfet?: Numero; vBCEfet?: Numero; pICMSEfet?: Numero; vICMSEfet?: Numero } | null;
  desoneracao?: { vICMSDeson?: Numero; motDesICMS?: string | number | null } | null;
  creditoSn?: { pCredSN?: Numero; vCredICMSSN?: Numero } | null;
};

export type SeveridadeIcms = 'BLOQUEIO' | 'AVISO' | 'INFO';

/** Documento que sustenta uma issue: responde "por que o ERP está avisando isso?". */
export type FonteIssueFiscal = {
  titulo: string;
  versao?: string;
  url?: string;
  regra?: string;
  cStat?: string;
  /** Data da última conferência da publicação oficial (AAAA-MM-DD). */
  revisadaEm?: string;
  /** AAAA-MM-DD */
  vigenciaDesde?: string;
  /** 'NACIONAL' ou a sigla da UF da política estadual. */
  jurisdicao: string;
};

export type IcmsIssue = {
  code: string;
  severidade: SeveridadeIcms;
  /** Somente divergências fiscais que dependem da decisão do operador. */
  requerCiencia?: boolean;
  field: string;
  message: string;
  fontes?: FonteIssueFiscal[];
  /**
   * Identifica a situação analisada (dados que produziram a issue + versão da
   * regra). A ciência vale só para ela: veja `chaveCiencia` em issuesFiscais.ts.
   */
  fingerprint?: string;
  /** Os dados que entraram no fingerprint, legíveis, para a trilha de auditoria. */
  dadosFingerprint?: Record<string, unknown>;
};

export type CampoIgnorado = {
  campo: string;
  valor: unknown;
  origem: string | null;
  motivo: string;
};

/** O que fica gravado no snapshot do item para explicar a nota depois. */
export type DecisaoIcms = {
  versaoRegraIcms: string;
  cst: string | null;
  csosn: string | null;
  grupoXmlIcms: GrupoIcmsXml;
  tratamentoIcms: NaturezaIcms;
  icmsProprio: boolean;
  stOperacao: boolean;
  stRetidaAnteriormente: boolean;
  reducaoBase: boolean;
  diferimento: boolean;
  desoneracao: boolean;
  creditoSn: boolean;
  /** Blocos que o grupo aceita. */
  camposAplicaveis: BlocoIcms[];
  /** Blocos que efetivamente foram para o XML. */
  camposInformados: BlocoIcms[];
  camposIgnorados: CampoIgnorado[];
  /** Somente avisos semânticos que exigiram ciência antes de gerar a nota. */
  avisosConfirmados: Array<{
    code: string;
    message: string;
    fingerprint?: string;
    fontes?: FonteIssueFiscal[];
    /** Registro em nfe_ciencia_aviso: quem confirmou e quando. */
    ciencia?: { id: number; usuarioId: string; confirmadoEm: string };
  }>;
  /** De onde saíram as bases: valor da operação, frete, seguro, outras despesas. */
  composicaoBase?: ComposicaoBaseIcms;
  motivo: string;
};

export type ResultadoIcms = {
  tratamento: TratamentoIcms | null;
  valores: IcmsCanonico | null;
  camposIgnorados: CampoIgnorado[];
  issues: IcmsIssue[];
  composicaoBase?: ComposicaoBaseIcms;
};
