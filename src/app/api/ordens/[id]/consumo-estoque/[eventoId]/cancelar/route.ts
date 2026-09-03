export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireOSEdit, requireOSEventosFinanceiros } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { lerMotivoCancelamento } from "@/lib/cancelamento";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Estorno do consumo: devolve o item ao estoque e encerra a despesa da OS.
 *
 * Este e o unico caminho de volta. Cancelar a saida pelo historico de estoque e
 * recusado pela propria RPC, porque devolveria o saldo e deixaria a despesa viva
 * na OS.
 */

type Params = { id: string; eventoId: string };

export async function POST(req: Request, { params }: { params: Promise<Params> }) {
  try {
    await requireOSEdit();
    await requireOSEventosFinanceiros();

    const { id, eventoId } = await params;
    const osId = Number(id);
    const eventId = Number(eventoId);
    if (!Number.isInteger(osId) || osId <= 0 || !Number.isInteger(eventId) || eventId <= 0) {
      return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
    }

    const motivo = await lerMotivoCancelamento(req);
    if (!motivo) {
      return NextResponse.json({ error: "Informe o motivo do cancelamento." }, { status: 400 });
    }

    // A RPC confere a OS pelo proprio evento; conferir aqui tambem impede que um
    // id de outra ordem passe pela URL de uma OS a que o usuario tem acesso.
    const { data: evento, error: erroEvento } = await supabaseAdmin
      .from("eventos_financeiros")
      .select("id")
      .eq("id", eventId)
      .eq("ordemservicoid", osId)
      .eq("origem", "CONSUMO")
      .maybeSingle();
    if (erroEvento) throw erroEvento;
    if (!evento) {
      return NextResponse.json({ error: "Consumo não encontrado nesta OS." }, { status: 404 });
    }

    const session = await auth().catch(() => null);
    const usuarioId = (session?.user as { id?: string } | undefined)?.id ?? null;

    const { data, error } = await supabaseAdmin.rpc("cancelar_consumo_produto_os", {
      p_evento_id: eventId,
      p_motivo: motivo,
      p_usuario: usuarioId,
    });

    if (error) {
      const status = error.code === "P0002" ? 404 : error.code === "P0001" ? 409 : error.code === "22023" ? 400 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json({ data });
  } catch (error: unknown) {
    const erro = error as { statusCode?: number; message?: string };
    return NextResponse.json(
      { error: erro?.message || "Não foi possível cancelar o consumo." },
      { status: erro?.statusCode || 500 },
    );
  }
}
