import type { AbaAluguel } from "@/lib/alugueis/status";
import type { AluguelDetalhe, AluguelLista, AluguelPayload } from "../types";

async function lerResposta<T>(resposta: Response, falha: string): Promise<T> {
  const json = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(json?.error || falha);
  return json as T;
}

function enviar(url: string, method: string, body?: unknown) {
  return fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export type ListaAlugueis = {
  items: AluguelLista[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export async function listarAlugueis(
  params: { aba: AbaAluguel; q?: string; page: number; limit: number; sort?: string; dir?: "asc" | "desc" },
  signal?: AbortSignal,
) {
  const busca = new URLSearchParams({ aba: params.aba, page: String(params.page), limit: String(params.limit) });
  if (params.q) busca.set("q", params.q);
  if (params.sort) busca.set("sort", params.sort);
  if (params.dir) busca.set("dir", params.dir);
  return lerResposta<ListaAlugueis>(await fetch(`/api/alugueis?${busca}`, { cache: "no-store", signal }), "Falha ao listar aluguéis.");
}

export async function contarAlugueis() {
  return lerResposta<Record<AbaAluguel, number>>(await fetch("/api/alugueis/stats", { cache: "no-store" }), "Falha ao contar aluguéis.");
}

export async function carregarAluguel(id: number) {
  return lerResposta<AluguelDetalhe>(await fetch(`/api/alugueis/${id}`, { cache: "no-store" }), "Falha ao carregar aluguel.");
}

export async function criarAluguel(payload: AluguelPayload) {
  return lerResposta<{ id: number }>(await enviar("/api/alugueis", "POST", payload), "Falha ao criar aluguel.");
}

export async function editarAluguel(id: number, payload: AluguelPayload) {
  return lerResposta<{ id: number }>(await enviar(`/api/alugueis/${id}`, "PUT", payload), "Falha ao salvar aluguel.");
}

export async function excluirAluguel(id: number, motivo: string) {
  return lerResposta(await enviar(`/api/alugueis/${id}`, "DELETE", { motivo }), "Falha ao excluir aluguel.");
}

export async function pausarAluguel(id: number) {
  return lerResposta(await enviar(`/api/alugueis/${id}/pausar`, "PUT"), "Falha ao pausar aluguel.");
}

export async function reiniciarAluguel(id: number) {
  return lerResposta(await enviar(`/api/alugueis/${id}/reiniciar`, "PUT"), "Falha ao reiniciar aluguel.");
}

export async function encerrarAluguel(id: number, dados: { encerradoEm?: string; observacao?: string }) {
  return lerResposta(await enviar(`/api/alugueis/${id}/encerrar`, "PUT", dados), "Falha ao encerrar aluguel.");
}

export type ItemChecklistEnvio = {
  titulo: string;
  descricao?: string | null;
  status?: string | null;
  observacao?: string | null;
  modeloItemId?: string | number | null;
};

export async function salvarChecklistAluguel(
  id: number,
  dados: { tipo: "SAIDA" | "RETORNO"; modeloId?: string | number | null; itens: ItemChecklistEnvio[] },
) {
  return lerResposta<{ checklist_id: number; itens: { id: number; titulo: string }[] }>(
    await enviar(`/api/alugueis/${id}/checklist`, "PUT", dados),
    "Falha ao salvar checklist.",
  );
}

export async function enviarFotosChecklist(itemId: number, arquivos: File[]) {
  const form = new FormData();
  arquivos.forEach((arquivo) => form.append("files", arquivo));
  return lerResposta(
    await fetch(`/api/alugueis/checklist-itens/${itemId}/imagens`, { method: "POST", body: form }),
    "Falha ao enviar fotos.",
  );
}

export async function excluirFotoChecklist(itemId: number, imageId: number) {
  return lerResposta(
    await fetch(`/api/alugueis/checklist-itens/${itemId}/imagens?imageId=${imageId}`, { method: "DELETE" }),
    "Falha ao excluir foto.",
  );
}

/** Avisa a lista e os contadores que algo mudou. */
export function avisarAlteracaoAlugueis() {
  window.dispatchEvent(new CustomEvent("alugueis:refresh"));
}
