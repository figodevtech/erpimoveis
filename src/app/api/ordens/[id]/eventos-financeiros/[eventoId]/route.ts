import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireOSEdit, requireOSEventosFinanceiros } from "@/app/api/_authz/perms";

type Params = { id: string; eventoId: string };
const STATUS_FINAIS = new Set(["CONCLUIDO", "SEM_COBRANCA", "CANCELADO"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    await requireOSEdit();
    await requireOSEventosFinanceiros();
    const { id, eventoId } = await params;
    const osId = Number(id);
    const eventId = Number(eventoId);
    if (!Number.isInteger(osId) || !Number.isInteger(eventId) || osId <= 0 || eventId <= 0) {
      return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
    }

    const { data: os, error: osError } = await supabaseAdmin
      .from("ordemservico")
      .select("id, status")
      .eq("id", osId)
      .eq("is_deleted", false)
      .maybeSingle();
    if (osError) throw osError;
    if (!os) return NextResponse.json({ error: "OS não encontrada." }, { status: 404 });
    if (STATUS_FINAIS.has(String(os.status))) {
      return NextResponse.json({ error: "Os snapshots não podem ser alterados após a finalização da OS." }, { status: 409 });
    }

    const body = await req.json();
    const valor = Number(body?.valor);
    if (!Number.isFinite(valor) || valor < 0) {
      return NextResponse.json({ error: "Informe um valor válido, igual ou maior que zero." }, { status: 400 });
    }

    const { data: evento, error: eventoError } = await supabaseAdmin
      .from("eventos_financeiros")
      .select("id, status, transacaoid, dados_snapshot")
      .eq("id", eventId)
      .eq("ordemservicoid", osId)
      .neq("status", "CANCELADO")
      .maybeSingle();
    if (eventoError) throw eventoError;
    if (!evento) return NextResponse.json({ error: "Evento financeiro não encontrado." }, { status: 404 });

    if (evento.status === "CONVERTIDO" || evento.transacaoid) {
      return NextResponse.json(
        { error: "Exclua a transação vinculada antes de editar este evento financeiro.", transacaoId: evento.transacaoid },
        { status: 409 },
      );
    }

    const session = await auth();
    const ajustadoEm = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("eventos_financeiros")
      .update({
        valor: Math.round(valor * 100) / 100,
        updated_at: ajustadoEm,
        dados_snapshot: {
          ...((evento.dados_snapshot as Record<string, unknown> | null) ?? {}),
          ajuste_manual: true,
          ajustado_em: ajustadoEm,
          ajustado_por: (session?.user as any)?.id ?? null,
        },
      })
      .eq("id", eventId)
      .eq("ordemservicoid", osId)
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ evento: data });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Erro ao atualizar snapshot." }, { status: error?.statusCode || 500 });
  }
}
