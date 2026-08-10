"use client";

export type Empresa = {
  empresaId: number;
  cnpj: string;
  razaosocial: string;
  nomefantasia?: string;
  inscricaoestadual?: string;
  inscricaomunicipal?: string;
  inscricaoestadualst?: string;
  endereco: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  codigomunicipio: string;
  cep?: string;
  uf?: string;
  codigopais?: string;
  nomepais?: string;
  telefone?: string;
  cnae?: string;
  regimetributario: "1" | "2" | "3" | "4";
  ambiente: "HOMOLOGACAO" | "PRODUCAO";
  certificadocaminho?: string;
  certificadosenha?: string;
  cschomologacao?: string;
  cscproducao?: string;
  placa_consulta_limite_mensal: number;
  placa_consulta_qtd_mes: number;
  placa_consulta_mes: string;
};

export type NFeCfg = {
  serieNFe: string;
  serieNFCe?: string;
  naturezaOperacao: string;
  naturezaOperacaoNFCe?: string;
  /**
   * CSC da NFC-e. Chega mascarado do backend (`*****A4F2`); só é regravado se o
   * usuário digitar um valor novo, sem "*".
   */
  cscHomologacao?: string;
  cscProducao?: string;
  /** ID do CSC é próprio de cada ambiente — produção e homologação diferem. */
  idCscHomologacao?: string;
  idCscProducao?: string;
  /** Leiaute do QR Code: "2" (com CSC) ou "3" (NT 2025.001, dispensa CSC). */
  qrCodeVersao?: string;
  /** false quando a empresa ainda não tem linha de configuração do modelo 65. */
  nfceConfigurada?: boolean;
};

export type NFSecfg = {
  provedor: string;
  inscricaoMunicipal?: string;
  serieRPS?: string;
  usuario?: string;
  senha?: string;
  token?: string;
  certificadoA1Base64?: string;
  senhaCertificado?: string;
};

export type CartaoCfg = {
  habilitado: boolean;
  provider: "stone";
  merchantId: string;
  apiKey: string;
  webhookUrl?: string;
  parcelasMax: number;
  capturaAutomatica: boolean;
  terminalIds?: string[];
};

export type PixCfg = {
  habilitado: boolean;
  provider: "stone" | "banco";
  chave: string;
  clientId?: string;
  clientSecret?: string;
  webhookUrl?: string;
  expiracaoSegundos: number;
};

export type DinheiroCfg = { habilitado: boolean };

export type FormValues = {
  empresa: Empresa;
  nfe: NFeCfg;
  nfse: NFSecfg;
  pagamentos: {
    cartao: CartaoCfg;
    pix: PixCfg;
    dinheiro: DinheiroCfg;
  };
};
