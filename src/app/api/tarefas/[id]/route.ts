// src/app/api/tarefas/[id]/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAuthenticated } from "@/app/api/_authz/perms";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const UpdateTarefaSchema = z.object({
  tipo: z.enum(["TAREFA", "NOTA"]).optional(),
  titulo: z
    .string()
    .trim()
    .min(1, "O título não pode ser vazio.")
    .max(255, "O título deve ter no máximo 255 caracteres.")
    .optional(),
  descricao: z.string().trim().max(4000).nullable().optional(),
  prioridade: z.enum(["BAIXA", "NORMAL", "ALTA"]).optional(),
  data_prevista: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "A data deve estar no formato AAAA-MM-DD.")
    .nullable()
    .optional(),
  fixada: z.boolean().optional(),
  status: z.enum(["ABERTA", "CONCLUIDA"]).optional(),
  lembrete_em: z.string().datetime().nullable().optional(),
});

type ParamsCtx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: ParamsCtx) {
  try {
    const session = await requireAuthenticated();
    const userId = (session.user as any)?.id as string | undefined;
    const ativo = (session.user as any)?.ativo !== false;

    if (!userId) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    if (!ativo) {
      return NextResponse.json({ error: "INACTIVE_USER" }, { status: 403 });
    }

    const { id } = await ctx.params;
    if (!id || !UUID_REGEX.test(id)) {
      return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("tarefa_usuario")
      .select("*")
      .eq("id", id)
      .eq("usuario_id", userId)
      .maybeSingle();

    if (error) {
      console.error("[GET /api/tarefas/[id]] Erro ao buscar tarefa:", error);
      return NextResponse.json({ error: "Erro ao buscar tarefa." }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Tarefa não encontrada." }, { status: 404 });
    }

    return NextResponse.json({ tarefa: data });
  } catch (err: any) {
    if (err?.statusCode === 401 || err?.message?.includes("Não autenticado")) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }
    console.error("[GET /api/tarefas/[id]] Erro interno:", err);
    return NextResponse.json({ error: "Erro interno do servidor." }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: ParamsCtx) {
  try {
    const session = await requireAuthenticated();
    const userId = (session.user as any)?.id as string | undefined;
    const ativo = (session.user as any)?.ativo !== false;

    if (!userId) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    if (!ativo) {
      return NextResponse.json({ error: "INACTIVE_USER" }, { status: 403 });
    }

    const { id } = await ctx.params;
    if (!id || !UUID_REGEX.test(id)) {
      return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
    }

    const parsed = UpdateTarefaSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || "Dados inválidos.";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const patch: Record<string, any> = {};

    if (parsed.data.tipo !== undefined) patch.tipo = parsed.data.tipo;
    if (parsed.data.titulo !== undefined) patch.titulo = parsed.data.titulo;
    if (parsed.data.descricao !== undefined) patch.descricao = parsed.data.descricao;
    if (parsed.data.prioridade !== undefined) patch.prioridade = parsed.data.prioridade;
    if (parsed.data.data_prevista !== undefined) patch.data_prevista = parsed.data.data_prevista;
    if (parsed.data.fixada !== undefined) patch.fixada = parsed.data.fixada;
    if (parsed.data.lembrete_em !== undefined) patch.lembrete_em = parsed.data.lembrete_em;

    if (parsed.data.status !== undefined) {
      patch.status = parsed.data.status;
      if (parsed.data.status === "CONCLUIDA") {
        patch.completed_at = new Date().toISOString();
      } else if (parsed.data.status === "ABERTA") {
        patch.completed_at = null;
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nenhum campo para atualizar." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("tarefa_usuario")
      .update(patch)
      .eq("id", id)
      .eq("usuario_id", userId)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("[PATCH /api/tarefas/[id]] Erro ao atualizar tarefa:", error);
      return NextResponse.json({ error: "Erro ao atualizar tarefa." }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Tarefa não encontrada." }, { status: 404 });
    }

    return NextResponse.json({ tarefa: data });
  } catch (err: any) {
    if (err?.statusCode === 401 || err?.message?.includes("Não autenticado")) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }
    console.error("[PATCH /api/tarefas/[id]] Erro interno:", err);
    return NextResponse.json({ error: "Erro interno do servidor." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: ParamsCtx) {
  try {
    const session = await requireAuthenticated();
    const userId = (session.user as any)?.id as string | undefined;
    const ativo = (session.user as any)?.ativo !== false;

    if (!userId) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    if (!ativo) {
      return NextResponse.json({ error: "INACTIVE_USER" }, { status: 403 });
    }

    const { id } = await ctx.params;
    if (!id || !UUID_REGEX.test(id)) {
      return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("tarefa_usuario")
      .delete()
      .eq("id", id)
      .eq("usuario_id", userId)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[DELETE /api/tarefas/[id]] Erro ao excluir tarefa:", error);
      return NextResponse.json({ error: "Erro ao excluir tarefa." }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Tarefa não encontrada." }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err?.statusCode === 401 || err?.message?.includes("Não autenticado")) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }
    console.error("[DELETE /api/tarefas/[id]] Erro interno:", err);
    return NextResponse.json({ error: "Erro interno do servidor." }, { status: 500 });
  }
}
