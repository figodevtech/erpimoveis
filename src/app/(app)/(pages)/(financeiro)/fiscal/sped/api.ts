import type {
  SpedActionResponse,
  SpedArquivo,
  SpedCompetenciaDetail,
  SpedCompetenciaResponse,
  SpedCompetenciasResponse,
  SpedContabilista,
  SpedContabilistaForm,
  SpedEntradaDataFiscalPendente,
} from "./types";

const API_ROOT = "/api/fiscal/sped";

type ApiErrorPayload = {
  error?: string;
  message?: string;
  detail?: string;
};

export class SpedApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SpedApiError";
    this.status = status;
  }
}

async function readPayload(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  return response.json().catch(() => null) as Promise<unknown>;
}

function apiMessage(payload: unknown, fallback: string) {
  const value = payload as ApiErrorPayload | null;
  return value?.message || value?.detail || value?.error || fallback;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = await readPayload(response);

  if (!response.ok) {
    throw new SpedApiError(apiMessage(payload, "Não foi possível concluir a operação do SPED."), response.status);
  }

  return payload as T;
}

async function importSpedFile(
  competenciaId: string,
  action: "importar-efd-anterior" | "importar-1601",
  file: File,
) {
  const body = new FormData();
  body.set("arquivo", file);
  return requestJson<{ data: { id: string; duplicate: boolean; lineCount?: number } }>(
    `${API_ROOT}/competencias/${encodeURIComponent(competenciaId)}/${action}`,
    { method: "POST", body },
  );
}

export function importPreviousEfdFile(competenciaId: string, file: File) {
  return importSpedFile(competenciaId, "importar-efd-anterior", file);
}

export function import1601File(competenciaId: string, file: File) {
  return importSpedFile(competenciaId, "importar-1601", file);
}

export function updateSpedConfiguration(companyId: number, patch: Record<string, unknown>) {
  return requestJson<{ data: Record<string, unknown> }>(`${API_ROOT}/configuracao`, {
    method: "PUT",
    body: JSON.stringify({ companyId, ...patch }),
  });
}

export function configureSpedFiscalItem(
  competenciaId: string,
  input: {
    itemSnapshotId: string;
    canonicalCode: string;
    itemType: string;
    creditTreatment?: string;
    evidence: string;
  },
) {
  return requestJson<{ data: Record<string, unknown> }>(
    `${API_ROOT}/competencias/${encodeURIComponent(competenciaId)}/itens`,
    { method: "PUT", body: JSON.stringify(input) },
  );
}

export function createSpedAssessmentAdjustment(competenciaId: string, input: Record<string, unknown>) {
  return requestJson<{ data: Record<string, unknown> }>(
    `${API_ROOT}/competencias/${encodeURIComponent(competenciaId)}/ajustes`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function deactivateSpedAssessmentAdjustment(competenciaId: string, adjustmentId: string) {
  return requestJson<{ data: { id: string } }>(
    `${API_ROOT}/competencias/${encodeURIComponent(competenciaId)}/ajustes`,
    { method: "DELETE", body: JSON.stringify({ adjustmentId }) },
  );
}

export function createSpedCompetencia(competencia: string) {
  return requestJson<SpedCompetenciaResponse>(`${API_ROOT}/competencias`, {
    method: "POST",
    body: JSON.stringify({ competence: competencia }),
  });
}

export async function listEntradasSemDataFiscal(signal?: AbortSignal) {
  const response = await requestJson<{ data: SpedEntradaDataFiscalPendente[] }>(`${API_ROOT}/entradas/data-fiscal`, { signal });
  return Array.isArray(response?.data) ? response.data : [];
}

export function confirmarDatasFiscaisDeEntrada(entradas: Array<{ id: string; dataEntradaFiscal: string }>) {
  return requestJson<{ data: { atualizadas: number } }>(`${API_ROOT}/entradas/data-fiscal`, {
    method: "PUT",
    body: JSON.stringify({ entradas }),
  });
}

export async function listSpedCompetencias(signal?: AbortSignal) {
  const response = await requestJson<SpedCompetenciasResponse>(`${API_ROOT}/competencias`, { signal });
  if (!Array.isArray(response?.data)) {
    throw new SpedApiError("A API retornou uma lista de competências inválida.", 502);
  }
  return response.data;
}

export async function getSpedCompetencia(id: string, signal?: AbortSignal) {
  const response = await requestJson<SpedCompetenciaResponse>(
    `${API_ROOT}/competencias/${encodeURIComponent(id)}`,
    { signal },
  );
  if (!response?.data || typeof response.data !== "object") {
    throw new SpedApiError("A API retornou uma competência inválida.", 502);
  }
  return response.data;
}

async function competenciaAction(
  id: string,
  action: "validar" | "fechar" | "reabrir" | "gerar",
  body?: Record<string, unknown>,
) {
  const response = await requestJson<SpedActionResponse | null>(
    `${API_ROOT}/competencias/${encodeURIComponent(id)}/${action}`,
    {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    },
  );
  return response ?? {};
}

export function validateSpedCompetencia(competencia: SpedCompetenciaDetail) {
  return competenciaAction(competencia.id, "validar", {
    expectedVersion: competencia.versao,
  });
}

export function closeSpedCompetencia(competencia: SpedCompetenciaDetail) {
  return competenciaAction(competencia.id, "fechar", {
    expectedVersion: competencia.versao,
  });
}

export function reopenSpedCompetencia(competencia: SpedCompetenciaDetail, motivo: string) {
  return competenciaAction(competencia.id, "reabrir", {
    expectedVersion: competencia.versao,
    motivo,
  });
}

export function generateSpedFile(
  competencia: SpedCompetenciaDetail,
  options?: { tipo?: "PREVIA" | "FINAL" },
) {
  return competenciaAction(competencia.id, "gerar", {
    expectedVersion: competencia.versao,
    tipo: options?.tipo,
  });
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function downloadSpedFile(file: SpedArquivo) {
  const response = await fetch(`${API_ROOT}/arquivos/${encodeURIComponent(file.id)}/download`, {
    cache: "no-store",
    headers: { Accept: "application/octet-stream, application/json" },
  });

  if (!response.ok) {
    const payload = await readPayload(response);
    throw new SpedApiError(apiMessage(payload, "Não foi possível baixar o arquivo SPED."), response.status);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { url?: string };
    if (!payload?.url) throw new SpedApiError("A API não retornou a URL assinada do arquivo.", 502);
    window.location.assign(payload.url);
    return;
  }

  downloadBlob(await response.blob(), file.nome || `sped-${file.id}.txt`);
}

export function createSpedContabilista(companyId: number, aPartirDe: string, data: SpedContabilistaForm) {
  return requestJson<{ data: SpedContabilista }>(`${API_ROOT}/contabilista`, {
    method: "POST",
    body: JSON.stringify({ ...data, companyId, aPartirDe }),
  });
}

export function updateSpedContabilista(companyId: number, id: string, data: SpedContabilistaForm) {
  return requestJson<{ data: SpedContabilista }>(`${API_ROOT}/contabilista`, {
    method: "PUT",
    body: JSON.stringify({ ...data, companyId, id }),
  });
}

export function recordSpedPvaValidation(
  fileId: string,
  input: {
    pvaVersao: string;
    status: "APROVADO" | "REJEITADO" | "COM_AVISOS";
    observacao?: string;
  },
) {
  return requestJson<{ data: import("./types").SpedPvaValidacao }>(
    `${API_ROOT}/arquivos/${encodeURIComponent(fileId)}/pva`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

