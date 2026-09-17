export type SpedCompetenciaStatus =
  | "ABERTA"
  | "EM_VALIDACAO"
  | "COM_ERROS"
  | "APTA"
  | "FECHADA";

export type SpedGateStatus = "PENDENTE" | "CONFIRMADO" | "NAO_APLICAVEL";

export type SpedDiagnosticSeverity = "BLOQUEIO" | "ERRO" | "AVISO" | "INFORMACAO";

export type SpedSourceReference = {
  tipo: string;
  descricao?: string | null;
  tabela?: string | null;
  registroId?: string | number | null;
  documento?: string | null;
  campo?: string | null;
  hash?: string | null;
};

export type SpedContagens = {
  total: number;
  entradas: number;
  saidas: number;
  cancelados: number;
  participantes: number;
  itens: number;
};

export type SpedDiagnosticoContagens = {
  bloqueios: number;
  erros: number;
  avisos: number;
  informacoes: number;
};

export type SpedGate = {
  id: string;
  codigo: string;
  titulo: string;
  descricao?: string | null;
  status: SpedGateStatus;
  evidencia?: string | null;
  confirmadoEm?: string | null;
  confirmadoPor?: string | null;
};

export type SpedCompetenciaSummary = {
  id: string;
  competencia: string;
  status: SpedCompetenciaStatus;
  layout: string;
  finalidade: "ORIGINAL" | "RETIFICADORA";
  versao: number | null;
  updatedAt: string | null;
  contagens: SpedContagens;
  diagnosticos: SpedDiagnosticoContagens;
  gates: SpedGate[];
  arquivoDisponivel: boolean;
};

export type SpedDocumento = {
  id: string;
  direcao: "ENTRADA" | "SAIDA";
  modelo: string;
  serie: string;
  numero: string;
  chave: string | null;
  participante: string;
  documentoParticipante?: string | null;
  dataFiscal: string;
  situacao: string;
  cfops: string[];
  valorTotal: number;
  fonteTabela: "nfe" | "entrada";
  fonteId: string;
  fiscalDfeDocumentoId: number | null;
  itens: Array<{
    id: string;
    numero: number;
    produtoId: number | null;
    itemConfigId: number | null;
    codigo: string;
    codigoXml: string | null;
    descricao: string;
    tipoItem: string | null;
    unidade: string;
    tratamentoCredito: "PENDENTE" | "CREDITAVEL" | "SEM_CREDITO" | "USO_CONSUMO" | "ATIVO_IMOBILIZADO" | "NAO_APLICAVEL";
  }>;
  fontes: SpedSourceReference[];
};

export type SpedParticipante = {
  id: string;
  codigo: string;
  nome: string;
  documento: string | null;
  inscricaoEstadual: string | null;
  municipio: string | null;
  pais: string | null;
  documentosReferenciados: number;
  fontes: SpedSourceReference[];
};

export type SpedItem = {
  id: string;
  codigo: string;
  descricao: string;
  tipoItem: string | null;
  ncm: string | null;
  cest: string | null;
  unidade: string | null;
  documentosReferenciados: number;
  possui0220: boolean;
  possui0221: boolean;
  fontes: SpedSourceReference[];
};

export type SpedApuracaoLinha = {
  id: string;
  grupo: string;
  codigo?: string | null;
  descricao: string;
  valor: number;
  origem: string;
  fontes: SpedSourceReference[];
};

export type SpedApuracao = {
  saldoCredorAnterior: number;
  totalDebitos: number;
  totalCreditos: number;
  totalAjustes: number;
  impostoRecolher: number;
  saldoTransportar: number;
  linhas: SpedApuracaoLinha[];
};

export type SpedPagamento1601 = {
  id: string;
  instituicao: string;
  documentoInstituicao: string;
  intermediario?: string | null;
  documentoIntermediario?: string | null;
  totalOperacoes: number;
  totalIss: number;
  totalOutros: number;
  origem: string;
  importadoEm?: string | null;
};

export type SpedInventario = {
  aplicabilidade: SpedGateStatus;
  dataInventario: string | null;
  motivo: string | null;
  status: string | null;
  quantidadeItens: number;
  valorTotal: number;
  atualizadoEm?: string | null;
};

export type SpedInconsistencia = {
  id: string;
  severidade: SpedDiagnosticSeverity;
  codigo: string;
  titulo: string;
  mensagem: string;
  registro?: string | null;
  campo?: string | null;
  resolvida: boolean;
  reconhecida?: boolean;
  criadoEm?: string | null;
  fontes: SpedSourceReference[];
};

export type SpedArquivo = {
  id: string;
  nome: string;
  tipo: "PREVIA" | "FINAL";
  finalidade: "ORIGINAL" | "RETIFICADORA";
  versao: number;
  layout: string;
  quantidadeRegistros: number;
  tamanhoBytes: number;
  sha256: string;
  geradoEm: string;
  geradoPor?: string | null;
  pvaStatus?: "PENDENTE" | "APROVADO" | "REJEITADO" | null;
};

export type SpedAuditoriaEvento = {
  id: string;
  acao: string;
  descricao: string;
  usuario?: string | null;
  ocorridoEm: string;
  versao?: number | null;
  detalhes?: Record<string, unknown> | null;
};

export type SpedConfiguracaoResumo = {
  empresaId: number;
  estabelecimento: string;
  cnpj: string;
  inscricaoEstadual: string | null;
  timezoneIana: string;
  perfil: string | null;
  perfilStatus: SpedGateStatus;
  indicadorAtividade: string | null;
  timezoneStatus: SpedGateStatus;
  indicadorAtividadeStatus: SpedGateStatus;
  blocoKObrigatorio: boolean | null;
  blocoKStatus: SpedGateStatus;
  registro1400Aplicavel: boolean | null;
  registro1400Status: SpedGateStatus;
  c176C179Aplicavel: boolean | null;
  c176C179Status: SpedGateStatus;
  registro1601Aplicavel: boolean | null;
  registro1601Status: SpedGateStatus;
  inventarioAplicavel: boolean | null;
  inventarioStatus: SpedGateStatus;
  inventarioFechamentoId: number | null;
  contribuinteIpi: boolean | null;
  contribuinteIpiStatus: SpedGateStatus;
  entregaEfdContribuicoes: boolean | null;
  entregaEfdContribuicoesStatus: SpedGateStatus;
  evidencias: Record<string, unknown>;
};

export type SpedCompetenciaDetail = SpedCompetenciaSummary & {
  configuracao: SpedConfiguracaoResumo;
  documentos: SpedDocumento[];
  participantes: SpedParticipante[];
  itens: SpedItem[];
  apuracao: SpedApuracao;
  ajustes: Array<{
    id: string;
    registroDestino: string;
    natureza: string;
    codigo: string;
    uf: string | null;
    valor: number;
    descricao: string;
    evidencia: string;
    numeroDocumento: string | null;
    referencia: Record<string, unknown>;
    criadoEm: string;
  }>;
  pagamentos1601: SpedPagamento1601[];
  importacoes: {
    efdAnterior: {
      id: string;
      competencia: string;
      nome: string;
      sha256: string;
      status: string;
      importadoEm: string;
    } | null;
    registros1601: Array<{
      id: string;
      nome: string;
      sha256: string;
      status: string;
      quantidadeLinhas: number;
      importadoEm: string;
    }>;
  };
  inventario: SpedInventario;
  inconsistencias: SpedInconsistencia[];
  arquivos: SpedArquivo[];
  auditoria: SpedAuditoriaEvento[];
  sourceCutoffAt?: string | null;
  contextHash?: string | null;
};

export type SpedCompetenciasResponse = {
  data: SpedCompetenciaSummary[];
};

export type SpedCompetenciaResponse = {
  data: SpedCompetenciaDetail;
};

export type SpedActionResponse = {
  data?: SpedCompetenciaDetail;
  message?: string;
};
