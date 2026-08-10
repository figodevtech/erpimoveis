// src/app/(app)/(pages)/meu-perfil/lib/api.ts
"use client";

import type {
  IndicadoresOrdens,
  MeuPerfil,
  MeuResumo,
  MeuServico,
  MinhaOrdem,
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

export function buscarMinhasOrdens({ signal, ...filtros }: ParametrosLista): Promise<Paginado<MinhaOrdem>> {
  return buscarJson<Paginado<MinhaOrdem>>(`/api/me/ordens?${montarQuery(filtros)}`, signal);
}

/** Totais da aba de ordens: dependem do período, não da página. */
export function buscarIndicadoresOrdens(
  { de, ate }: Periodo,
  usuarioId?: string,
  signal?: AbortSignal,
): Promise<IndicadoresOrdens> {
  const params = new URLSearchParams();
  if (de) params.set("de", de);
  if (ate) params.set("ate", ate);
  comUsuario(params, usuarioId);
  return buscarJson<IndicadoresOrdens>(`/api/me/ordens/indicadores?${params.toString()}`, signal);
}

export function buscarMeusServicos({ signal, ...filtros }: ParametrosLista): Promise<Paginado<MeuServico>> {
  return buscarJson<Paginado<MeuServico>>(`/api/me/servicos?${montarQuery(filtros)}`, signal);
}
