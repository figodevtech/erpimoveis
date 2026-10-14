import type { DocumentoModelo, ModuloDocumento } from "@/lib/documentos/tipos";

export type DocumentoPayload = {
  nome: string;
  modulo: ModuloDocumento;
  html: string;
  ativo: boolean;
  ordem: number;
};

async function corpoOuErro<T>(resposta: Response, fallback: string): Promise<T> {
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo?.error || fallback);
  return corpo as T;
}

export async function listarDocumentos(): Promise<DocumentoModelo[]> {
  const resposta = await fetch("/api/config/documentos", { cache: "no-store" });
  const { items } = await corpoOuErro<{ items: DocumentoModelo[] }>(resposta, "Erro ao listar documentos.");
  return items ?? [];
}

export async function criarDocumento(payload: DocumentoPayload): Promise<DocumentoModelo> {
  const resposta = await fetch("/api/config/documentos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await corpoOuErro<{ item: DocumentoModelo }>(resposta, "Erro ao criar documento.")).item;
}

export async function atualizarDocumento(id: number, payload: DocumentoPayload): Promise<DocumentoModelo> {
  const resposta = await fetch(`/api/config/documentos/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await corpoOuErro<{ item: DocumentoModelo }>(resposta, "Erro ao salvar documento.")).item;
}

export async function excluirDocumento(id: number): Promise<void> {
  const resposta = await fetch(`/api/config/documentos/${id}`, { method: "DELETE" });
  await corpoOuErro(resposta, "Erro ao excluir documento.");
}
