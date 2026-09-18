// src/lib/nfe/types.ts

import type { ICMSUFDest } from './difal';
import type { IndIEDest } from './indIEDest';
import type { DecisaoIcms, IcmsCanonico } from './icms/tipos';

export type { ICMSUFDest };

// =====================
// Modelo do documento fiscal
// =====================
/** 55 = NF-e, 65 = NFC-e. Conversões em `./modeloDocumento`. */
export type ModeloDocumentoFiscal = 55 | 65;
/** Como o modelo é gravado em `nfe.modelo` e `nfe_config.modelo`. */
export type ModeloDocumentoFiscalDb = "NFE" | "NFCE";

// =====================
// Tabela EMPRESA (Supabase)
// =====================
export type CRT = 1 | 2 | 3 | 4;
export type OrigemMercadoria = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
export type CSOSN = '101' | '102' | '103' | '201' | '202' | '203' | '300' | '400' | '500' | '900';
export type CSTICMS = '00' | '10' | '20' | '30' | '40' | '41' | '50' | '51' | '60' | '70' | '90';
export type CSTPisCofins =
  | '01' | '02' | '03' | '04' | '05' | '06' | '07' | '08' | '09'
  | '49' | '50' | '51' | '52' | '53' | '54' | '55' | '56' | '60'
  | '61' | '62' | '63' | '64' | '65' | '66' | '67' | '70' | '71'
  | '72' | '73' | '74' | '75' | '98' | '99';

export type ModoCalculoPisCofins = 'PERCENTUAL' | 'QUANTIDADE' | 'NAO_TRIBUTADO';
export type IbsCbsOption = 'SIMPLES' | 'REGULAR' | 'NOT_APPLICABLE';

export type TributoPisCofins = {
  cst: CSTPisCofins | string;
  modo: ModoCalculoPisCofins;
  base?: number;
  aliquota?: number;
  quantidade?: number;
  aliquotaPorUnidade?: number;
  valor?: number;
};

export type ParcelaIbsCbs = {
  aliquota: number;
  percentualReducao?: number;
  aliquotaEfetiva?: number;
  percentualDiferimento?: number;
  valorDiferido?: number;
  valor: number;
};

export type TributosRtc = {
  cstIbsCbs: string;
  cClassTrib: string;
  baseCalculo: number;
  ibsUf: ParcelaIbsCbs;
  ibsMunicipio: ParcelaIbsCbs;
  valorIbs: number;
  cbs: ParcelaIbsCbs;
  versaoClassificacao?: string;
  validadoEm?: string;
};

export type ImpostoSeletivo = {
  cst: string;
  cClassTrib: string;
  baseCalculo?: number;
  aliquota?: number;
  unidadeTributavel?: string;
  quantidadeTributavel?: number;
  aliquotaEspecifica?: number;
  valor: number;
};

export type ClassificacaoTributariaRtc = {
  codigo: string;
  cst: string;
  nome: string;
  descricao?: string | null;
  percentualReducaoIbs?: number | null;
  percentualReducaoCbs?: number | null;
  inicioVigencia: string;
  fimVigencia?: string | null;
  permiteNfe: boolean;
  indicadores?: Record<string, boolean | string | number | null>;
  versaoFonte: string;
};

export type EmpresaRow = {
  id: number;
  cnpj: string;
  razaosocial: string;
  nomefantasia: string | null;
  inscricaoestadual: string | null;
  inscricaomunicipal: string | null;
  endereco: string;
  codigomunicipio: string;
  regimetributario: CRT | `${CRT}` | string | number | null;
  certificadocaminho: string | null;
  cschomologacao: string | null;
  cscproducao: string | null;
  ambiente: "HOMOLOGACAO" | "PRODUCAO" | null;
  createdat: string | null;
  updatedat: string | null;
  bairro: string | null;
  numero: string | null;
  complemento: string | null;
  cep: string | null;
  uf: string | null;
  codigopais: string | null;
  nomepais: string | null;
  telefone: string | null;
  cnae: string | null;
  inscricaoestadualst: string | null;
  certificadosenha: string | null;
};

export type CrtNFe = "1" | "2" | "3" | "4";

// =====================
// Tabela CLIENTE (Supabase)
// =====================
export type ClienteRow = {
  id: number;
  tipopessoa?: string | null;
  cpfcnpj: string;
  nomerazaosocial: string;
  email?: string | null;
  telefone?: string | null;
  endereco?: string | null;
  endereconumero?: string | null;
  enderecocomplemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
  inscricaoestadual?: string | null;
  inscricaomunicipal?: string | null;
  codigomunicipio?: string | null;
  /** indIEDest escolhido no cadastro. `null` = ainda não classificado. */
  ind_ie_dest?: number | null;
};

// =====================
// Tipos de NF-e
// =====================

export type NFeEndereco = {
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  codigoMunicipio: string;
  nomeMunicipio: string;
  uf: string;
  cep: string;
  codigoPais: string;
  nomePais: string;
  telefone?: string;
};

export type NFeEmitente = {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia?: string;
  inscricaoEstadual: string;
  inscricaoEstadualST?: string;
  inscricaoMunicipal?: string;
  cnae?: string;
  crt: CRT | `${CRT}`;
  endereco: NFeEndereco;
};

export type NFeIde = {
  cUF: string;
  cNF: string;
  natOp: string;
  mod: string;
  serie: number;
  nNF: number;
  dhEmi: string;
  tpNF: 0 | 1;
  idDest: 1 | 2 | 3;
  cMunFG: string;
  tpImp: 1 | 2 | 3 | 4 | 5;
  tpEmis: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  cDV: string;
  tpAmb: 1 | 2;
  finNFe: 1 | 2 | 3 | 4;
  indFinal: 0 | 1;
  indPres: 0 | 1 | 2 | 3 | 4 | 5 | 9;
  procEmi: 0 | 1 | 2 | 3;
  verProc: string;
};

/** Documento fiscal relacionado no grupo de identificação da NF-e. */
export type NFeDocumentoReferenciado = {
  /** Chave de acesso de uma NF-e modelo 55. */
  chaveAcesso: string;
};

/** Referência granular introduzida no item pela NT 2025.002. */
export type NFeDFeReferenciado = {
  chaveAcesso: string;
  /** Número do item no documento fiscal original. */
  nItem?: number | null;
};

export type NFeDestinatario = {
  cpf?: string;
  cnpj?: string;
  razaoSocial: string;
  /**
   * indIEDest: 1 contribuinte do ICMS, 2 contribuinte isento, 9 não contribuinte.
   * Vem do cadastro do cliente — nunca deduzido da existência da IE.
   */
  indIEDest: IndIEDest | "1" | "2" | "9";
  /** Só é enviada ao XML quando `indIEDest` é 1. Ver `buildDestXml`. */
  inscricaoEstadual?: string;
  endereco: NFeEndereco;
};

export interface NFeItem {
  numeroItem: number;
  codigoProduto: string;
  descricao: string;
  ncm: string;
  cfop: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  valorFrete?: number;
  /**
   * Desconto incondicional do item (vDesc). Reúne o desconto dado no próprio
   * item e a parcela do desconto geral da OS/venda rateada para ele. Reduz a
   * base de ICMS/PIS/COFINS/IPI e o vNF, mas não altera vUnCom nem vProd —
   * a nota continua mostrando o preço de tabela e o abatimento em separado.
   */
  valorDesconto?: number;
  codigoBarras?: string | null;
  cest?: string | null;


  // ---------- ICMS ----------
  /**
   * Origem da mercadoria. Default controlado: "0" (nacional), quando o item
   * legado ainda nao informa esse campo.
   */
  orig?: OrigemMercadoria | string | number | null;

  /**
   * CST genérico de ICMS (espelha coluna `cst` da tabela produto/nfe_item).
   * Ex.: "00", "20", "10"...
   */
  cst?: CSTICMS | string | null;

  /**
   * CST de ICMS (nome mais explícito, se você quiser usar também).
   * Pode espelhar o mesmo valor de `cst`.
   */
  cstIcms?: CSTICMS | string | null;

  /**
   * CSOSN (para Simples Nacional)
   * Ex.: "101", "102", "103"...
   */
  csosn?: CSOSN | string | null;

  /**
   * Alíquota de ICMS em percentual (ex.: 18 => 18%)
   */
  aliquotaIcms?: number;
  pICMS?: number;
  modBC?: 0 | 1 | 2 | 3 | string | number | null;
  vBC?: number;
  vICMS?: number;

  /**
   * Base do ICMS próprio informada explicitamente (vBC). Nunca é preenchida só
   * porque existe alíquota: num grupo sem ICMS próprio (60, 40...) ela é erro.
   */
  baseCalculoIcms?: number;

  /** Valor do ICMS próprio informado explicitamente (vICMS). Mesma regra da base. */
  valorIcms?: number;

  pRedBC?: number;
  modBCST?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | string | number | null;
  pMVAST?: number;
  pRedBCST?: number;
  vBCST?: number;
  pICMSST?: number;
  vICMSST?: number;
  vBCSTRet?: number;
  pST?: number;
  vICMSSubstituto?: number;
  vICMSSTRet?: number;
  pCredSN?: number;
  vCredICMSSN?: number;
  vFCP?: number;
  vBCFCP?: number;
  pFCP?: number;
  vBCFCPST?: number;
  pFCPST?: number;
  vFCPST?: number;
  vBCFCPSTRet?: number;
  pFCPSTRet?: number;
  vFCPSTRet?: number;
  vICMSDeson?: number;
  motDesICMS?: string | number | null;
  cBenef?: string | null;
  vICMSOp?: number;
  pDif?: number;
  vICMSDif?: number;

  /**
   * Grupo ICMS decidido pelo núcleo (`src/lib/nfe/icms`). Quando presente, é a
   * única fonte do XML, dos totais e de `nfe_item`: os campos soltos acima
   * passam a ser só a classificação de origem. Sem ele, o núcleo decide a
   * partir dos campos soltos.
   */
  icms?: IcmsCanonico;
  /** Por que o grupo ficou assim: vai para o snapshot do item. */
  icmsDecisao?: DecisaoIcms;

  // ---------- PIS ----------
  /**
   * CST de PIS (ex.: "01", "07", "99"...)
   */
  cstPis?: CSTPisCofins | string | null;

  /**
   * Alíquota de PIS em percentual (ex.: 0.65 => 0,65%)
   */
  aliquotaPis?: number;

  /**
   * Valor de PIS (vPIS)
   */
  valorPis?: number;

  // ---------- COFINS ----------
  /**
   * CST de COFINS (ex.: "01", "07", "99"...)
   */
  cstCofins?: CSTPisCofins | string | null;

  /**
   * Alíquota de COFINS em percentual (ex.: 3 => 3%)
   */
  aliquotaCofins?: number;

  /**
   * Valor de COFINS (vCOFINS)
   */
  valorCofins?: number;

  /** Estruturas explícitas usadas pelo motor novo. Os aliases acima continuam
   * sendo lidos para compatibilidade com notas antigas. */
  pis?: TributoPisCofins;
  cofins?: TributoPisCofins;

  // ---------- IPI ----------
  cstIpi?: string | null;
  codigoEnquadramentoIpi?: string | null;
  baseCalculoIpi?: number;
  aliquotaIpi?: number;
  quantidadeIpi?: number;
  valorUnidadeIpi?: number;
  valorIpi?: number;

  // ---------- Devolução / documento referenciado ----------
  /** Percentual da mercadoria devolvida, de 0,01 a 100%. */
  percentualDevolucao?: number;
  /** Parcela do IPI devolvida neste item. */
  valorIpiDevolvido?: number;
  /** Documento e linha de origem deste item (NT 2025.002). */
  dfeReferenciado?: NFeDFeReferenciado;
  /** Informações adicionais específicas do item. */
  informacoesAdicionaisProduto?: string | null;

  // ---------- DIFAL (ICMSUFDest) ----------
  /**
   * Grupo de partilha do ICMS para a UF de destino. Preenchido pelo motor
   * quando a operação é interestadual para consumidor final não contribuinte.
   * Os campos abaixo permitem sobrepor as alíquotas resolvidas por padrão.
   */
  icmsUfDest?: ICMSUFDest;
  aliquotaInternaDestino?: number | null;
  aliquotaInterestadual?: number | null;
  aliquotaFcpDestino?: number | null;
  /** Base do FCP quando diferente da base do DIFAL. */
  baseCalculoFcpDestino?: number | null;
  percentualPartilhaDestino?: number | null;

  // ---------- Reforma tributária ----------
  rtc?: TributosRtc;
  impostoSeletivo?: ImpostoSeletivo;
}
