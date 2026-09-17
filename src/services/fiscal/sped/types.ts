import type { SpedCompetenciaStatus, SpedDiagnosticSeverity, SpedGateStatus } from "@/lib/sped/efd-icms-ipi";

export type SpedGateView = {
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
  contagens: { total: number; entradas: number; saidas: number; cancelados: number; participantes: number; itens: number };
  diagnosticos: { bloqueios: number; erros: number; avisos: number; informacoes: number };
  gates: SpedGateView[];
  arquivoDisponivel: boolean;
};

export type SpedCompetenciaDetail = SpedCompetenciaSummary & {
  configuracao: {
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
  documentos: Array<Record<string, unknown>>;
  participantes: Array<Record<string, unknown>>;
  itens: Array<Record<string, unknown>>;
  apuracao: {
    saldoCredorAnterior: number;
    totalDebitos: number;
    totalCreditos: number;
    totalAjustes: number;
    impostoRecolher: number;
    saldoTransportar: number;
    linhas: Array<Record<string, unknown>>;
  };
  ajustes: Array<Record<string, unknown>>;
  pagamentos1601: Array<Record<string, unknown>>;
  importacoes: {
    efdAnterior: Record<string, unknown> | null;
    registros1601: Array<Record<string, unknown>>;
  };
  inventario: Record<string, unknown>;
  inconsistencias: Array<{
    id: string;
    severidade: SpedDiagnosticSeverity;
    codigo: string;
    titulo: string;
    mensagem: string;
    registro: string | null;
    campo: string | null;
    resolvida: boolean;
    reconhecida: boolean;
    criadoEm: string | null;
    fontes: Array<Record<string, unknown>>;
  }>;
  arquivos: Array<Record<string, unknown>>;
  auditoria: Array<Record<string, unknown>>;
  sourceCutoffAt: string | null;
  contextHash: string | null;
};

export type SpedEntradaDataFiscalPendente = {
  id: string;
  numeroNota: string | null;
  serieNota: string | null;
  chave: string | null;
  fornecedor: string | null;
  documentoFornecedor: string | null;
  valorTotal: number;
  dataEmissao: string | null;
  dataLancamento: string | null;
  dataSugerida: string | null;
};
