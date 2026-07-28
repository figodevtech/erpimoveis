import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { matchesFiscalNoteSearch } from "@/lib/fiscal-search";

export type FiscalViewMode = "TODAS" | "EMITIDAS_POR_NOS" | "EMITIDAS_TERCEIROS";

export type NotaFiscalListParams = {
  page?: number;
  limit?: number;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  viewMode?: FiscalViewMode;
  status?: string;
  modelo?: string;
};

type PessoaFiscal = {
  id: number;
  nomerazaosocial: string | null;
  cpfcnpj: string | null;
};

export type NotaFiscalListItem = {
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
  destinatarioOuEmitente: PessoaFiscal | null;
  empresa: {
    id: number;
    razaosocial: string | null;
    nomefantasia: string | null;
    cnpj: string | null;
  } | null;
};

export type NotaFiscalKpis = {
  total: number;
  emitidasPorNos: number;
  emitidasTerceiros: number;
  autorizadas: number;
  canceladas: number;
  rejeitadas: number;
  valorTotal: number;
  valorEmitidasPorNos: number;
  valorEmitidasTerceiros: number;
};

const SELECT_NOTAS = `
  id,
  modelo,
  serie,
  numero,
  chave_acesso,
  ambiente,
  status,
  dataemissao,
  dataautorizacao,
  protocolo,
  total_nfe,
  ordemservicoid,
  vendaid,
  entradaid,
  clienteid,
  fornecedorid,
  empresaid,
  tpNF,
  destinatario_snapshot,
  cliente:clienteid (
    id,
    nomerazaosocial,
    cpfcnpj
  ),
  fornecedor:fornecedorid (
    id,
    nomerazaosocial,
    cpfcnpj
  ),
  empresa:empresaid (
    id,
    razaosocial,
    nomefantasia,
    cnpj
  )
`;

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function notaDirecao(row: any): Exclude<FiscalViewMode, "TODAS"> {
  void row;
  return "EMITIDAS_POR_NOS";
}

function mapNotaFiscal(row: any): NotaFiscalListItem {
  const direcao = notaDirecao(row);
  const snapshot = row.destinatario_snapshot;
  const pessoa = row.cliente ?? row.fornecedor;

  return {
    id: Number(row.id),
    origem: "PROPRIA" as const,
    modelo: String(row.modelo ?? ""),
    serie: Number(row.serie ?? 0),
    numero: Number(row.numero ?? 0),
    chave_acesso: String(row.chave_acesso ?? ""),
    ambiente: String(row.ambiente ?? ""),
    status: String(row.status ?? ""),
    dataemissao: String(row.dataemissao ?? ""),
    dataautorizacao: row.dataautorizacao ?? null,
    protocolo: row.protocolo ?? null,
    total_nfe: Number(row.total_nfe ?? 0),
    ordemservicoid: row.ordemservicoid == null ? null : Number(row.ordemservicoid),
    vendaid: row.vendaid == null ? null : Number(row.vendaid),
    entradaid: row.entradaid == null ? null : Number(row.entradaid),
    clienteid: row.clienteid == null ? null : Number(row.clienteid),
    fornecedorid: row.fornecedorid == null ? null : Number(row.fornecedorid),
    empresaid: Number(row.empresaid),
    tpNF: row.tpNF == null ? null : Number(row.tpNF),
    direcao,
    destinatarioOuEmitente: pessoa
      ? {
          id: Number(pessoa.id),
          nomerazaosocial: pessoa.nomerazaosocial ?? null,
          cpfcnpj: pessoa.cpfcnpj ?? null,
        }
      : snapshot
        ? {
            id: 0,
            nomerazaosocial: snapshot.razaoSocial ?? null,
            cpfcnpj: snapshot.cnpj ?? snapshot.cpf ?? null,
          }
      : null,
    empresa: row.empresa
      ? {
          id: Number(row.empresa.id),
          razaosocial: row.empresa.razaosocial ?? null,
          nomefantasia: row.empresa.nomefantasia ?? null,
          cnpj: row.empresa.cnpj ?? null,
        }
      : null,
  };
}

function applyFilters(query: any, params: NotaFiscalListParams) {
  const dateFrom = normalizeText(params.dateFrom);
  const dateTo = normalizeText(params.dateTo);
  const status = normalizeText(params.status);
  const modelo = normalizeText(params.modelo);
  const viewMode = params.viewMode ?? "TODAS";

  query = query.eq("is_deleted", false);

  if (viewMode === "EMITIDAS_TERCEIROS") {
    query = query.eq("id", -1);
  }

  if (dateFrom) {
    query = query.gte("dataemissao", dateFrom);
  }

  if (dateTo) {
    const endDate = dateTo.length <= 10 ? `${dateTo}T23:59:59.999` : dateTo;
    query = query.lte("dataemissao", endDate);
  }

  if (status) {
    query = query.eq("status", status);
  }

  if (modelo) {
    query = query.eq("modelo", modelo);
  }

  return query;
}

function buildKpis(rows: NotaFiscalListItem[]): NotaFiscalKpis {
  const statusUpper = (status: string) => status.toUpperCase();
  const emitidasPorNos = rows.filter((row) => row.direcao === "EMITIDAS_POR_NOS");
  const emitidasTerceiros = rows.filter((row) => row.direcao === "EMITIDAS_TERCEIROS");

  return {
    total: rows.length,
    emitidasPorNos: emitidasPorNos.length,
    emitidasTerceiros: emitidasTerceiros.length,
    autorizadas: rows.filter((row) =>
      ["AUTORIZADA", "AUTORIZADO", "EMITIDA"].includes(statusUpper(row.status)),
    ).length,
    canceladas: rows.filter((row) => statusUpper(row.status) === "CANCELADA").length,
    rejeitadas: rows.filter((row) => statusUpper(row.status) === "REJEITADA").length,
    valorTotal: rows.reduce((sum, row) => sum + row.total_nfe, 0),
    valorEmitidasPorNos: emitidasPorNos.reduce((sum, row) => sum + row.total_nfe, 0),
    valorEmitidasTerceiros: emitidasTerceiros.reduce((sum, row) => sum + row.total_nfe, 0),
  };
}

export async function buscarKpisNotasEmitidasProprias() {
  const { data, error } = await supabaseAdmin
    .from("nfe")
    .select("id, status, total_nfe")
    .eq("is_deleted", false);

  if (error) throw error;

  const rows = (data ?? []).map((row: any) => ({
    id: Number(row.id),
    origem: "PROPRIA" as const,
    modelo: "NFE",
    serie: 0,
    numero: 0,
    chave_acesso: "",
    ambiente: "",
    status: String(row.status ?? ""),
    dataemissao: "",
    dataautorizacao: null,
    protocolo: null,
    total_nfe: Number(row.total_nfe ?? 0),
    ordemservicoid: null,
    vendaid: null,
    entradaid: null,
    clienteid: null,
    fornecedorid: null,
    empresaid: 0,
    tpNF: null,
    direcao: "EMITIDAS_POR_NOS" as const,
    destinatarioOuEmitente: null,
    empresa: null,
  }));

  return buildKpis(rows);
}

export async function listarNotasEmitidas(params: NotaFiscalListParams) {
  const page = clampInt(params.page, 1, 1, 10_000);
  const limit = clampInt(params.limit, 20, 1, 100);
  const from = (page - 1) * limit;
  const baseQuery = applyFilters(
    supabaseAdmin
      .from("nfe")
      .select(SELECT_NOTAS)
      .order("dataemissao", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false }),
    params,
  );

  const { data, error } = await baseQuery;

  if (error) {
    throw error;
  }

  const kpiRows = (data ?? [])
    .map(mapNotaFiscal)
    .filter((nota: NotaFiscalListItem) => matchesFiscalNoteSearch(nota, params.search));
  const notas = kpiRows.slice(from, from + limit);

  return {
    data: notas,
    kpis: buildKpis(kpiRows),
    pagination: {
      total: kpiRows.length,
      page,
      limit,
      totalPages: Math.ceil(kpiRows.length / limit),
    },
  };
}

export async function buscarXmlNotaEmitida(id: number) {
  const { data, error } = await supabaseAdmin
    .from("nfe")
    .select("id, chave_acesso, xml_autorizado, xml_assinado")
    .eq("id", id)
    .eq("is_deleted", false)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const xml = data.xml_autorizado || data.xml_assinado || "";
  return {
    id: Number(data.id),
    chave: String(data.chave_acesso ?? ""),
    xml,
  };
}
