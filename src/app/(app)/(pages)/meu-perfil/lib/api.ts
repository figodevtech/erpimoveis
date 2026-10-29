// src/app/(app)/(pages)/meu-perfil/lib/api.ts
"use client";

import type {
  IndicadoresVendas,
  MeuPerfil,
  MeuResumo,
  MinhaVenda,
  Paginado,
  Periodo,
} from "../types";

type ParametrosLista = Periodo & {
  page: number;
  limit: number;
  status?: string;
  signal?: AbortSignal;
  usuarioId?: string;
};

function comUsuario(params: URLSearchParams, usuarioId?: string) {
  if (usuarioId) params.set("usuarioId", usuarioId);
  return params;
}

async function buscarJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const resposta = await fetch(url, { cache: "no-store", signal });
  const corpo = (await resposta.json().catch(() => ({}))) as { error?: string };

  if (!resposta.ok) {
    throw new Error(corpo?.error || "Não foi possível carregar os dados.");
  }

  return corpo as T;
}

function montarQuery({ de, ate, page, limit, status, usuarioId }: Omit<ParametrosLista, "signal">) {
  const params = new URLSearchParams();
  if (de) params.set("de", de);
  if (ate) params.set("ate", ate);
  params.set("page", String(page));
  params.set("limit", String(limit));
  if (status && status !== "TODOS") params.set("status", status);
  comUsuario(params, usuarioId);
  return params.toString();
}

export function buscarPerfil(usuarioId?: string, signal?: AbortSignal): Promise<MeuPerfil> {
  const params = comUsuario(new URLSearchParams(), usuarioId);
  return buscarJson<MeuPerfil>(`/api/me/perfil?${params.toString()}`, signal);
}

/** Opções do seletor de perfil; a API recusa quem não pode ver outros usuários. */
export async function buscarUsuariosDoSeletor(
  signal?: AbortSignal,
): Promise<Array<{ id: string; nome: string; email: string }>> {
  const corpo = await buscarJson<{ users?: Array<{ id: string; nome: string; email: string }> }>(
    "/api/me/usuarios",
    signal,
  );
  return corpo.users ?? [];
}

export async function enviarFotoPerfil(file: File, usuarioId?: string): Promise<{ fotoUrl: string }> {
  const params = comUsuario(new URLSearchParams(), usuarioId);
  const formData = new FormData();
  formData.set("file", file);

  const resposta = await fetch(`/api/me/perfil/foto?${params.toString()}`, {
    method: "POST",
    body: formData,
  });
  const corpo = (await resposta.json().catch(() => ({}))) as { fotoUrl?: string; error?: string };

  if (!resposta.ok || !corpo.fotoUrl) {
    throw new Error(corpo.error || "Não foi possível salvar a foto do perfil.");
  }

  return { fotoUrl: corpo.fotoUrl };
}

export function buscarResumo({ de, ate }: Periodo, usuarioId?: string, signal?: AbortSignal): Promise<MeuResumo> {
  const params = new URLSearchParams();
  if (de) params.set("de", de);
  if (ate) params.set("ate", ate);
  comUsuario(params, usuarioId);
  return buscarJson<MeuResumo>(`/api/me/resumo?${params.toString()}`, signal);
}

export function buscarMinhasVendas({ signal, ...filtros }: ParametrosLista): Promise<Paginado<MinhaVenda>> {
  return buscarJson<Paginado<MinhaVenda>>(`/api/me/vendas?${montarQuery(filtros)}`, signal);
}

/** Totais da aba de vendas: dependem do período, não da página. */
export function buscarIndicadoresVendas(
  { de, ate }: Periodo,
  usuarioId?: string,
  signal?: AbortSignal,
): Promise<IndicadoresVendas> {
  const params = new URLSearchParams();
  if (de) params.set("de", de);
  if (ate) params.set("ate", ate);
  comUsuario(params, usuarioId);
  return buscarJson<IndicadoresVendas>(`/api/me/vendas/indicadores?${params.toString()}`, signal);
}
