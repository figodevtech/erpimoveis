import type { AlvoFiscal } from "@/lib/fiscal/blocosDeObservacao";

export type ModeloEmissao = "NACIONAL" | "MUNICIPAL_CABEDELO" | "MUNICIPAL_JOAO_PESSOA";

export type CodigosFiscaisForm = {
  itemListaServico: string;
  codigoCnae: string;
  codigoTributacaoNacionalIss: string;
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
  padraoFiscal?: Partial<CodigosFiscaisForm> | null;
  cliente?: ClienteResumo | null;
  /** Observações fiscais da OS, herdadas pelas informações complementares. */
  observacoesFiscais?: string | null;
  /** Alvo do reparo, para o botão que injeta os dados dele no texto livre. */
  alvo?: AlvoFiscal | null;
  /** Divisão do desconto da OS. Null quando a ordem não tem desconto geral. */
  descontoOrigem?: DescontoOrigemNfse | null;
};

/** Limite das informações complementares nos três modelos de NFS-e. */
export const LIMITE_INFORMACOES_COMPLEMENTARES = 2000;

export type ValoresServicosForm = Record<number, string>;

export const EMPTY_CODIGOS: CodigosFiscaisForm = {
  itemListaServico: "",
  codigoCnae: "",
  codigoTributacaoNacionalIss: "",
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
