import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireOSEdit, requireOSEventosFinanceiros } from "@/app/api/_authz/perms";

type Params = { id: string; eventoId: string };
const STATUS_FINAIS = new Set(["CONCLUIDO", "SEM_COBRANCA", "CANCELADO"]);

export async function POST(_: NextRequest, { params }: { params: Promise<Params> }) {
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
      .select("status")
      .eq("id", osId)
      .eq("is_deleted", false)
      .maybeSingle();
    if (osError) throw osError;
    if (!os) return NextResponse.json({ error: "OS não encontrada." }, { status: 404 });
    if (STATUS_FINAIS.has(String(os.status))) {
      return NextResponse.json({ error: "Não é possível sincronizar custos após a finalização da OS." }, { status: 409 });
    }

    const { data: evento, error: eventoError } = await supabaseAdmin
      .from("eventos_financeiros")
      .select("id, produtoid, quantidade_snapshot, dados_snapshot, valor, origem, natureza, status")
      .eq("id", eventId)
      .eq("ordemservicoid", osId)
      .maybeSingle();
    if (eventoError) throw eventoError;
    if (!evento || evento.origem !== "PRODUTO" || evento.natureza !== "DESPESA" || evento.status !== "ATIVO") {
      return NextResponse.json({ error: "Este evento não é um snapshot de custo de produto." }, { status: 409 });
    }
    if (Number(evento.valor) !== 0) {
      return NextResponse.json({ error: "A sincronização está disponível somente para snapshots zerados." }, { status: 409 });
    }

    const { data: produto, error: produtoError } = await supabaseAdmin
      .from("produto")
      .select("id, ultimovalordecompra")
      .eq("id", evento.produtoid)
      .maybeSingle();
    if (produtoError) throw produtoError;
    const custoUnitario = Number(produto?.ultimovalordecompra ?? 0);
    if (!produto || !Number.isFinite(custoUnitario) || custoUnitario <= 0) {
      return NextResponse.json({ error: "O produto continua sem um último valor de entrada válido." }, { status: 409 });
    }

    let quantidade = Number(evento.quantidade_snapshot ?? 0);
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      const { data: item } = await supabaseAdmin
        .from("osproduto")
        .select("quantidade")
        .eq("ordemservicoid", osId)
        .eq("produtoid", evento.produtoid)
        .maybeSingle();
      quantidade = Number(item?.quantidade ?? 0);
    }
    const valor = Math.round(custoUnitario * quantidade * 100) / 100;
    const sincronizadoEm = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("eventos_financeiros")
      .update({
        valor,
        valor_unitario_snapshot: custoUnitario,
        quantidade_snapshot: quantidade,
        updated_at: sincronizadoEm,
        dados_snapshot: {
          ...((evento.dados_snapshot as Record<string, unknown> | null) ?? {}),
          custo_nao_informado: false,
          custo_estimado: true,
          ultimo_custo_sincronizado_em: sincronizadoEm,
        },
      })
      .eq("id", eventId)
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ evento: data });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Erro ao sincronizar último custo." }, { status: error?.statusCode || 500 });
  }
}
