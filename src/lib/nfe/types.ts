// src/lib/nfe/types.ts

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

export type NFeDestinatario = {
  cpf?: string;
  cnpj?: string;
  razaoSocial: string;
  indIEDest: "1" | "2" | "3" | "9" | string;
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
   * Base de cálculo de ICMS (vBC) – opcional, hoje calculamos em cima do valorTotal.
   */
  baseCalculoIcms?: number;

  /**
   * Valor de ICMS (vICMS) – opcional, hoje calculamos em cima do valorTotal.
   */
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

  // ---------- Reforma tributária ----------
  rtc?: TributosRtc;
  impostoSeletivo?: ImpostoSeletivo;
}
