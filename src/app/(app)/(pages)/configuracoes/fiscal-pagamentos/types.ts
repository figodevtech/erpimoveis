"use client";

import type { Empresa } from "@/app/(app)/(pages)/configuracoes/empresa/types";
import type { NFSeModeloEmissao as ModeloEmissao } from "@/lib/services/fiscais/nfse-politica";

export type { Empresa };

/** Códigos fiscais de um padrão de emissão de NFS-e, como campos de formulário. */
export type CodigosFiscaisForm = {
  itemListaServico: string;
  codigoCnae: string;
  codigoTributacaoNacionalIss: string;
  /** cTribMun do padrão Nacional (3 dígitos), quando o município exige. */
  codigoTributacaoMunicipalIss: string;
  situacaoTributariaPisCofins: string;
  codigoNbs: string;
  aliquotaIss: string;
  naturezaOperacao: string;
  issRetido: string;
  tributacaoIss: string;
  tipoRetencaoIss: string;
  finalidadeEmissao: string;
  consumidorFinal: string;
  indicadorDestinatario: string;
  codigoIndicadorOperacao: string;
  ibsCbsSituacaoTributaria: string;
  ibsCbsClassificacaoTributaria: string;
  informacoesComplementares: string;
  /**
   * Como o prestador se declara na DPS Nacional. Só existem no padrão da
   * empresa: a emissão lê do padrão, nunca da tela.
   */
  regimeEspecialTributacao?: string;
  regimeApuracaoSimplesNacional?: string;
};

/** Um conjunto de padrões fiscais. Tudo string: são campos de formulário. */
export type PadraoFiscalForm = {
  origem_mercadoria?: string;
  cfop?: string;
  csosn?: string;
  cst?: string;
  aliquotaicms?: string;
  cst_pis?: string;
  modo_pis?: string;
  aliquota_pis?: string;
  aliquota_por_unidade_pis?: string;
  cst_cofins?: string;
  modo_cofins?: string;
  aliquota_cofins?: string;
  aliquota_por_unidade_cofins?: string;
  rtc_habilitado?: boolean;
  cst_ibscbs?: string;
  cclass_trib?: string;
  aliquota_ibs_uf?: string;
  aliquota_ibs_municipio?: string;
  aliquota_cbs?: string;
};

export type ModeloPadraoFiscal = "NFE" | "NFCE";
/**
 * `SAIDA` é a saída de venda (venda, OS, NFC-e, avulsa). `SAIDA_NAO_VENDA` é a
 * saída de estoque que não vende: devolução de compra, remessa para conserto,
 * retorno, garantia. Os nomes das chaves são os mesmos do jsonb em
 * `nfe_config.padroes_emissao` — ver `src/lib/nfe/padraoFiscalItem.ts`.
 */
export type OperacaoPadraoFiscal = "SAIDA" | "SAIDA_NAO_VENDA" | "ENTRADA";

export type PadroesFiscaisForm = Record<
  ModeloPadraoFiscal,
  Partial<Record<OperacaoPadraoFiscal, PadraoFiscalForm>>
>;

export type NFeCfg = {
  serieNFe: string;
  serieNFCe?: string;
  naturezaOperacao: string;
  naturezaOperacaoNFCe?: string;
  incluirGarantiaVendaNFe: boolean;
  incluirGarantiaVendaNFCe: boolean;
  incluirGarantiaOsNFe: boolean;
  incluirGarantiaOsNFCe: boolean;
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
  /**
   * Perfil tributário padrão dos itens, por modelo e por operação. Preenche na
   * emissão o que o cadastro do produto deixou em branco — produto preenchido
   * continua vencendo. NCM e CEST não entram aqui: são do item.
   */
  padroesFiscais?: PadroesFiscaisForm;
};

export type NFSecfg = {
  provedor: string;
  incluirGarantiaOs: boolean;
  inscricaoMunicipal?: string;
  serieRPS?: string;
  usuario?: string;
  senha?: string;
  token?: string;
  certificadoA1Base64?: string;
  senhaCertificado?: string;
  /**
   * Códigos que já vêm preenchidos ao emitir uma NFS-e, por modelo de emissão.
   *
   * Precisa viajar junto no formulário: o `PUT /api/config/nfse` regrava
   * `padroes_emissao` com o que receber, então salvar a aba sem este campo
   * apagaria o padrão inteiro.
   */
  padroesEmissao?: Partial<Record<ModeloEmissao, Partial<CodigosFiscaisForm>>>;
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
  /**
   * Cadastro da empresa, só de leitura nesta tela — quem edita é Configurações ›
   * Empresa. Viaja no formulário porque `regimetributario` e `codigomunicipio`
   * decidem o modelo de NFS-e e se o item usa CSOSN ou CST; sem eles as abas não
   * sabem o que mostrar. O `onSalvar` daqui nunca faz PUT em `/api/config/empresa`.
   */
  empresa: Empresa;
  nfe: NFeCfg;
  nfse: NFSecfg;
  pagamentos: {
    cartao: CartaoCfg;
    pix: PixCfg;
    dinheiro: DinheiroCfg;
  };
};
