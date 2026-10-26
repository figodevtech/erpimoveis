import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { PERMS, type Permission } from "@/app/api/_authz/permission-constants";

import { CATALOGOS } from "./catalogo";
import { montarContexto } from "./contexto-server";
import { renderizarModelo } from "./motor";
import {
  LIMITE_HTML_DOCUMENTO,
  MODULOS_DOCUMENTO,
  type DocumentoModelo,
  type DocumentoParaEmitir,
  type ModuloDocumento,
} from "./tipos";

export const COLUNAS_DOCUMENTO = "id, codigo_padrao, modulo, nome, html, ativo, ordem, impressao_rapida, created_at, updated_at";

/** Quem pode emitir os documentos de cada módulo: quem enxerga o módulo. */
export const PERMISSAO_DO_MODULO: Record<ModuloDocumento, Permission> = {
  venda: PERMS.VENDAS,
  os: PERMS.ORDENS,
  aluguel: PERMS.ALUGUEIS,
};

export const DocumentoSchema = z.object({
  nome: z.string().trim().min(1, "Dê um nome ao documento.").max(120, "Nome longo demais (máximo de 120 caracteres)."),
  modulo: z.enum(MODULOS_DOCUMENTO, { errorMap: () => ({ message: "Módulo inválido." }) }),
  html: z
    .string()
    .refine((v) => v.trim().length > 0, "O documento está vazio.")
    .refine((v) => v.length <= LIMITE_HTML_DOCUMENTO, "O documento passou do limite de 200 mil caracteres."),
  ativo: z.boolean().default(true),
  ordem: z.number().int().min(0).max(9999).default(0),
  // Sem o campo, a gravação não mexe nele (e o banco cria desligado).
  impressao_rapida: z.boolean().optional(),
});

export type DocumentoEntrada = z.infer<typeof DocumentoSchema>;

export class ErroDocumento extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

export async function usuarioDaSessao(): Promise<string> {
  const session = await auth();
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) throw new ErroDocumento("Não autenticado.", 401);
  return id;
}

export function idDaRota(valor: string): number {
  const id = Number(valor);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ErroDocumento("Documento inválido.", 400);
  return id;
}

export function respostaDeErro(error: unknown, fallback: string) {
  const falha = error as { message?: string; statusCode?: number; code?: string; issues?: unknown };
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  }
  const status =
    falha?.statusCode ??
    (falha?.code === "23505" ? 409 : falha?.code === "23514" ? 400 : undefined) ??
    (/autenticado|permiss/i.test(falha?.message ?? "") ? 403 : 500);
  const mensagem =
    falha?.code === "23505" ? "Já existe um documento com esse nome neste módulo." : falha?.message || fallback;
  if (status >= 500) console.error(fallback, error);
  return NextResponse.json({ error: mensagem }, { status });
}

export async function listarDocumentos(modulo?: ModuloDocumento | null): Promise<DocumentoModelo[]> {
  let consulta = supabaseAdmin
    .from("documento_modelo")
    .select(COLUNAS_DOCUMENTO)
    .eq("is_deleted", false)
    .order("modulo")
    .order("ordem")
    .order("nome");
  if (modulo) consulta = consulta.eq("modulo", modulo);
  const { data, error } = await consulta;
  if (error) throw error;
  return (data ?? []) as DocumentoModelo[];
}

/** Os modelos ativos de um módulo, na ordem do dropdown. */
export async function listarParaEmitir(modulo: ModuloDocumento): Promise<DocumentoParaEmitir[]> {
  const { data, error } = await supabaseAdmin
    .from("documento_modelo")
    .select("id, nome, impressao_rapida")
    .eq("modulo", modulo)
    .eq("ativo", true)
    .eq("is_deleted", false)
    .order("ordem")
    .order("nome");
  if (error) throw error;
  return (data ?? []) as DocumentoParaEmitir[];
}

export async function buscarDocumento(id: number): Promise<DocumentoModelo | null> {
  const { data, error } = await supabaseAdmin
    .from("documento_modelo")
    .select(COLUNAS_DOCUMENTO)
    .eq("id", id)
    .eq("is_deleted", false)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as DocumentoModelo | null;
}

/**
 * O modelo preenchido com o registro, igual na aba do documento e na
 * impressão rápida. `null` quando o registro não existe.
 */
export async function preencherDocumento(modelo: DocumentoModelo, registroId: number): Promise<string | null> {
  const session = await auth();
  const usuario = session?.user as { nome?: string | null; name?: string | null; email?: string | null } | undefined;
  const contexto = await montarContexto(modelo.modulo, registroId, {
    nomeDocumento: modelo.nome,
    emitidoPor: usuario?.nome ?? usuario?.name ?? usuario?.email ?? null,
    agora: new Date(),
  });
  return contexto ? renderizarModelo(modelo.html, contexto, CATALOGOS[modelo.modulo]) : null;
}

export async function criarDocumento(entrada: DocumentoEntrada, usuarioId: string) {
  const { data, error } = await supabaseAdmin
    .from("documento_modelo")
    .insert({ ...entrada, nome: entrada.nome.trim(), created_by: usuarioId, updated_by: usuarioId })
    .select(COLUNAS_DOCUMENTO)
    .single();
  if (error) throw error;
  return data as DocumentoModelo;
}

export async function atualizarDocumento(id: number, entrada: DocumentoEntrada, usuarioId: string) {
  const { data, error } = await supabaseAdmin
    .from("documento_modelo")
    .update({ ...entrada, nome: entrada.nome.trim(), updated_by: usuarioId })
    .eq("id", id)
    .eq("is_deleted", false)
    .select(COLUNAS_DOCUMENTO)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ErroDocumento("Documento não encontrado.", 404);
  return data as DocumentoModelo;
}

export async function excluirDocumento(id: number, usuarioId: string) {
  const { data, error } = await supabaseAdmin
    .from("documento_modelo")
    .update({ is_deleted: true, ativo: false, updated_by: usuarioId })
    .eq("id", id)
    .eq("is_deleted", false)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ErroDocumento("Documento não encontrado.", 404);
}
