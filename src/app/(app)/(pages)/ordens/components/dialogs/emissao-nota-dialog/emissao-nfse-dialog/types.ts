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

export type ServicoOS = {
  servicoid: number;
  quantidade: number | null;
  precounitario: number | null;
  servico?: ServicoCadastro | null;
  pendenciasCadastro?: string[];
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
};

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
