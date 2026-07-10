export type FiscalViewMode = "TODAS" | "EMITIDAS_POR_NOS" | "EMITIDAS_TERCEIROS";

export interface FiscalPessoa {
  id: number;
  nomerazaosocial: string | null;
  cpfcnpj: string | null;
}

export interface NotaFiscal {
  id: number;
  origem?: "PROPRIA" | "TERCEIROS";
  modelo: string;
  serie: number;
  numero: number;
  chave_acesso: string;
  ambiente: string;
  status: string;
  dataemissao: string;
  dataautorizacao: string | null;
  protocolo: string | null;
  total_nfe: number;
  ordemservicoid: number | null;
  vendaid: number | null;
  entradaid: number | null;
  clienteid: number | null;
  fornecedorid: number | null;
  empresaid: number;
  tpNF: number | null;
  direcao: Exclude<FiscalViewMode, "TODAS">;
  nsu?: string | null;
  tipoDocumento?: string | null;
  statusManifestacao?: string | null;
  xmlStatus?: "XML_COMPLETO" | "AGUARDANDO_XML" | "AGUARDANDO_MANIFESTACAO" | "NAO_AUTORIZADO" | string;
  xmlStatusLabel?: string | null;
  destinatarioOuEmitente: FiscalPessoa | null;
  empresa: {
    id: number;
    razaosocial: string | null;
    nomefantasia: string | null;
    cnpj: string | null;
  } | null;
}

export interface FiscalKpis {
  total: number;
  emitidasPorNos: number;
  emitidasTerceiros: number;
  autorizadas: number;
  canceladas: number;
  rejeitadas: number;
  valorTotal: number;
  valorEmitidasPorNos: number;
  valorEmitidasTerceiros: number;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
