import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireOSEdit } from "@/app/api/_authz/perms";

type Params = { id: string };
type ChecklistStatus = "OK" | "ALERTA" | "FALHA";

const STATUS_PERMITIDOS = new Set(["PAGAMENTO", "CONCLUIDO", "SEM_COBRANCA"]);

function statusChecklist(value: unknown): ChecklistStatus | null {
  const normalized = String(value ?? "").toUpperCase();
  return normalized === "OK" || normalized === "ALERTA" || normalized === "FALHA"
    ? normalized
    : null;
}

export async function POST(req: NextRequest, context: { params: Promise<Params> }) {
  try {
    await requireOSEdit();
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

    const { id } = await context.params;
    const osId = Number(id);
    if (!Number.isInteger(osId) || osId <= 0) {
      return NextResponse.json({ error: "ID de OS inválido." }, { status: 400 });
    }

    const body = await req.json().catch(() => null) as any;
    const saidaEm = body?.saidaEm ? new Date(body.saidaEm) : new Date();
    if (Number.isNaN(saidaEm.getTime())) {
      return NextResponse.json({ error: "Data de saída inválida." }, { status: 400 });
    }

    const osRes = await supabaseAdmin
      .from("ordemservico")
      .select("id, status, datasaida")
      .eq("id", osId)
      .maybeSingle();
    if (osRes.error) throw osRes.error;
    if (!osRes.data) return NextResponse.json({ error: "OS não encontrada." }, { status: 404 });
    if (!STATUS_PERMITIDOS.has(String(osRes.data.status ?? "").toUpperCase())) {
      return NextResponse.json(
        { error: "A saída só pode ser registrada a partir do pagamento." },
        { status: 409 },
      );
    }
    if (osRes.data.datasaida) {
      return NextResponse.json({ error: "A saída desta OS já foi registrada." }, { status: 409 });
    }

    const rawItems = Array.isArray(body?.checklist) ? body.checklist : [];
    const checklist = rawItems.map((item: any, index: number) => ({
      modelo_item_id: Number(item?.modeloItemId) || null,
      titulo: String(item?.titulo ?? "").trim(),
      descricao: String(item?.descricao ?? "").trim() || null,
      categoria: String(item?.categoria ?? "").trim() || null,
      status: statusChecklist(item?.status),
      observacao: String(item?.observacao ?? "").trim() || null,
      ordem: Number.isFinite(Number(item?.ordem)) ? Number(item.ordem) : index,
    }));
    if (checklist.some((item: any) => !item.titulo || !item.status)) {
      return NextResponse.json({ error: "Preencha a situação de todos os itens do checklist." }, { status: 400 });
    }

    const exitRes = await supabaseAdmin
      .from("os_saida")
      .insert({
        ordemservico_id: osId,
        saida_em: saidaEm.toISOString(),
        retirado_por: String(body?.retiradoPor ?? "").trim() || null,
        documento_observacao: String(body?.documentoObservacao ?? "").trim() || null,
        checklist_modelo_id: Number(body?.checklistModeloId) || null,
        registrado_por: userId,
        created_by: userId,
      })
      .select("id")
      .single();
    if (exitRes.error) {
      if (exitRes.error.code === "23505") {
        return NextResponse.json({ error: "A saída desta OS já foi registrada." }, { status: 409 });
      }
      throw exitRes.error;
    }

    try {
      if (checklist.length) {
        const itemRes = await supabaseAdmin.from("os_saida_checklist_item").insert(
          checklist.map((item: any) => ({ ...item, os_saida_id: exitRes.data.id, created_by: userId })),
        ).select("id, titulo");
        if (itemRes.error) throw itemRes.error;
      }

      const updateRes = await supabaseAdmin
        .from("ordemservico")
        .update({ datasaida: saidaEm.toISOString() })
        .eq("id", osId)
        .is("datasaida", null);
      if (updateRes.error) throw updateRes.error;
    } catch (error) {
      await supabaseAdmin.from("os_saida").delete().eq("id", exitRes.data.id);
      throw error;
    }

    const createdItems = await supabaseAdmin.from("os_saida_checklist_item").select("id, titulo").eq("os_saida_id", exitRes.data.id);
    if (createdItems.error) throw createdItems.error;
    return NextResponse.json({ ok: true, saidaEm: saidaEm.toISOString(), checklistCreated: createdItems.data ?? [] }, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/ordens/[id]/saida", error);
    return NextResponse.json({ error: error?.message || "Falha ao registrar saída." }, { status: 500 });
  }
}
