import type { AlvoFiscal } from "@/lib/fiscal/blocosDeObservacao";

export type { NFSeModeloEmissao as ModeloEmissao } from "@/lib/services/fiscais/nfse-politica";
import type { NFSeModeloEmissao as ModeloEmissao } from "@/lib/services/fiscais/nfse-politica";

export type CodigosFiscaisForm = {
  itemListaServico: string;
  codigoCnae: string;
  codigoTributacaoNacionalIss: string;
  /** cTribMun do padrão Nacional (3 dígitos), quando o município exige. */
  codigoTributacaoMunicipalIss: string;
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

/** O que a política de emissão diz à tela, além do modelo. */
export type PoliticaEmissaoResumo = {
  /** Grupo da Reforma Tributária obrigatório nesta emissão. */
  exigeRtc: boolean;
  motivo: string;
  regimeTributario: string;
};

export type ServicoCadastro = {
  descricao?: string | null;
  cnae?: string | null;
  itemlistaservico?: string | null;
  codigoservicomunicipal?: string | null;
  aliquotaiss?: number | null;
};

export type PendenciaOrigem = "EMPRESA" | "CLIENTE" | "SERVICO";

export type PendenciaCadastro = {
  origem: PendenciaOrigem;
  mensagem: string;
};

export type ClienteResumo = {
  id: number;
  nomerazaosocial?: string | null;
  tipopessoa?: "FISICA" | "JURIDICA" | null;
  cpfcnpj?: string | null;
  email?: string | null;
  telefone?: string | null;
  endereco?: string | null;
  endereconumero?: string | null;
  enderecocomplemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
  codigomunicipio?: string | null;
  inscricaomunicipal?: string | null;
};

/**
 * Como o desconto geral da OS foi dividido entre a NF-e de produto e esta
 * NFS-e. Mesmos campos que a rota `produtos-para-nfe` devolve, de propósito.
 */
export type DescontoOrigemNfse = {
  total: number;
  produtos: number;
  servicos: number;
  baseProdutos: number;
  baseServicos: number;
};

export type ServicoOS = {
  servicoid: number;
  quantidade: number | null;
  precounitario: number | null;
  /**
   * Texto livre da linha da OS (`osservico.descricao`) — o que foi feito no
   * serviço. Não confundir com `servico.descricao`, o nome do cadastro.
   */
  descricao?: string | null;
  servico?: ServicoCadastro | null;
  pendenciasCadastro?: PendenciaCadastro[];
  /**
   * Desconto que cabe a este serviço — o da própria linha da OS, a fatia do
   * desconto geral e o líquido resultante. Informativos: a emissão continua
   * mandando o valor digitado no campo, sem abater nada sozinha.
   */
  descontoItem?: number | null;
  descontoRateado?: number | null;
  valorLiquidoSugerido?: number | null;
  notaFiscalStatus?: string | null;
  notaFiscalId?: number | null;
  notaFiscalErros?: unknown;
  notaFiscalModelo?: ModeloEmissao | null;
  notaFiscalReferencia?: string | null;
  notaFiscalValor?: number | null;
};

export type ServicosOSResponse = {
  ok: boolean;
  message?: string;
  servicos?: ServicoOS[];
  modeloEmissao?: ModeloEmissao | null;
  politicaEmissao?: PoliticaEmissaoResumo | null;
  /** Visão da OS inteira; a revisão usa o padrão de `ContextoEmissaoResponse`. */
  padraoAusente?: boolean;
  padraoFiscal?: Partial<CodigosFiscaisForm> | null;
  cliente?: ClienteResumo | null;
  /** Texto inicial das informações complementares, já composto para edição. */
  observacoesFiscais?: string | null;
  /** Alvo do reparo, para o botão que injeta os dados dele no texto livre. */
  alvo?: AlvoFiscal | null;
  /** Divisão do desconto da OS. Null quando a ordem não tem desconto geral. */
  descontoOrigem?: DescontoOrigemNfse | null;
};

/**
 * Resposta de `POST /api/nfse/contexto-emissao/[osId]`: o modelo e o padrão
 * dos serviços SELECIONADOS. É o que preenche a etapa de revisão.
 */
export type ContextoEmissaoResponse = {
  ok: boolean;
  message?: string;
  modeloEmissao?: ModeloEmissao;
  politicaEmissao?: PoliticaEmissaoResumo;
  /** Padrão do modelo final, ou null. Nunca o de outro modelo. */
  padraoFiscal?: Partial<CodigosFiscaisForm> | null;
  padraoAusente?: boolean;
  observacoesFiscais?: string | null;
  pendenciasCadastro?: PendenciaCadastro[];
};

/** Limite das informações complementares nos três modelos de NFS-e. */
export const LIMITE_INFORMACOES_COMPLEMENTARES = 2000;

export type ValoresServicosForm = Record<number, string>;

export const EMPTY_CODIGOS: CodigosFiscaisForm = {
  itemListaServico: "",
  codigoCnae: "",
  codigoTributacaoNacionalIss: "",
  codigoTributacaoMunicipalIss: "",
  codigoNbs: "",
  aliquotaIss: "",
  naturezaOperacao: "",
  issRetido: "",
  tributacaoIss: "",
  tipoRetencaoIss: "",
  finalidadeEmissao: "",
  consumidorFinal: "",
  indicadorDestinatario: "",
  codigoIndicadorOperacao: "",
  ibsCbsSituacaoTributaria: "",
  ibsCbsClassificacaoTributaria: "",
  informacoesComplementares: "",
};
