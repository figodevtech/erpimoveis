// src/app/api/tarefas/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAuthenticated } from "@/app/api/_authz/perms";

const CreateTarefaSchema = z.object({
  tipo: z.enum(["TAREFA", "NOTA"]).default("TAREFA"),
  titulo: z
    .string({ error: (issue) => issue.input === undefined ? "O título é obrigatório." : undefined })
    .trim()
    .min(1, "O título é obrigatório.")
    .max(255, "O título deve ter no máximo 255 caracteres."),
  descricao: z.string().trim().max(4000).nullable().optional(),
  prioridade: z.enum(["BAIXA", "NORMAL", "ALTA"]).default("NORMAL"),
  data_prevista: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "A data deve estar no formato AAAA-MM-DD.")
    .nullable()
    .optional(),
  fixada: z.boolean().default(false),
  lembrete_em: z.string().datetime().nullable().optional(),
});

function sanitizeSearchQuery(query: string): string {
  return query.replace(/[%_,\\]/g, "");
}

export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view") || "hoje";
    const tipo = searchParams.get("tipo");
    const ref = searchParams.get("ref") || new Date().toISOString().slice(0, 10);
    const rawSearch = searchParams.get("q")?.trim() || "";

    let query = supabaseAdmin
      .from("tarefa_usuario")
      .select("*")
      .eq("usuario_id", userId);

    if (tipo === "TAREFA" || tipo === "NOTA") {
      query = query.eq("tipo", tipo);
    }

    if (view === "hoje") {
      // Tarefas abertas vencidas ou previstas para a data de corte local
      query = query
        .eq("tipo", "TAREFA")
        .eq("status", "ABERTA")
        .lte("data_prevista", ref);
    } else if (view === "proximas") {
      // Tarefas abertas com data prevista futura
      query = query
        .eq("tipo", "TAREFA")
        .eq("status", "ABERTA")
        .gt("data_prevista", ref);
    } else if (view === "todas") {
      // Todas as tarefas abertas (ou todas as notas se tipo === 'NOTA')
      if (tipo === "NOTA") {
        query = query.eq("tipo", "NOTA");
      } else {
        query = query.eq("tipo", "TAREFA").eq("status", "ABERTA");
      }
    } else if (view === "notas") {
      // Apenas itens do tipo NOTA
      query = query.eq("tipo", "NOTA");
    } else if (view === "concluidas") {
      // Tarefas concluídas
      query = query.eq("tipo", "TAREFA").eq("status", "CONCLUIDA");
    } else if (view === "favoritas") {
      // Itens fixados / favoritos
      query = query.eq("fixada", true);
    }

    if (rawSearch) {
      const sanitized = sanitizeSearchQuery(rawSearch);
      if (sanitized) {
        query = query.or(`titulo.ilike.%${sanitized}%,descricao.ilike.%${sanitized}%`);
      }
    }

    if (view === "concluidas") {
      query = query.order("completed_at", { ascending: false, nullsFirst: false });
    } else {
      query = query
        .order("fixada", { ascending: false })
        .order("data_prevista", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
    }

    query = query.limit(150);

    const { data, error } = await query;

    if (error) {
      console.error("[GET /api/tarefas] Erro ao buscar tarefas:", error);
      return NextResponse.json({ error: "Erro ao buscar tarefas." }, { status: 500 });
    }

    return NextResponse.json({ tarefas: data ?? [] });
  } catch (err: any) {
    if (err?.statusCode === 401 || err?.message?.includes("Não autenticado")) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }
    console.error("[GET /api/tarefas] Erro interno:", err);
    return NextResponse.json({ error: "Erro interno do servidor." }, { status: 500 });
  }
}

export async function POST(request: Request) {
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

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
    }

    const parsed = CreateTarefaSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || "Dados inválidos.";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const insertPayload = {
      usuario_id: userId,
      tipo: parsed.data.tipo,
      titulo: parsed.data.titulo,
      descricao: parsed.data.descricao || null,
      prioridade: parsed.data.prioridade,
      data_prevista:
        parsed.data.tipo === "TAREFA"
          ? parsed.data.data_prevista || new Date().toISOString().slice(0, 10)
          : parsed.data.data_prevista || null,
      lembrete_em: parsed.data.lembrete_em || null,
      fixada: parsed.data.fixada,
      status: "ABERTA",
    };

    const { data, error } = await supabaseAdmin
      .from("tarefa_usuario")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      console.error("[POST /api/tarefas] Erro ao criar tarefa:", error);
      return NextResponse.json({ error: "Erro ao salvar tarefa." }, { status: 500 });
    }

    return NextResponse.json({ tarefa: data }, { status: 201 });
  } catch (err: any) {
    if (err?.statusCode === 401 || err?.message?.includes("Não autenticado")) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }
    console.error("[POST /api/tarefas] Erro interno:", err);
    return NextResponse.json({ error: "Erro interno do servidor." }, { status: 500 });
  }
}
