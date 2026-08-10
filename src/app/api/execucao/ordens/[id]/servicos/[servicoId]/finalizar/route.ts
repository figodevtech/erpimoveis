export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getExecucaoSession, getOrdemDoSetor, isNextResponse } from "../../../../../_helpers";

type Params = { id: string; servicoId: string };

async function calcularConclusaoDaOrdem(ordemservicoid: number) {
  const [servicosRes, realizadoresRes] = await Promise.all([
    supabaseAdmin
      .from("osservico")
      .select("servicoid")
      .eq("ordemservicoid", ordemservicoid),
    supabaseAdmin
      .from("osservico_realizador")
      .select("servicoid, status_execucao")
      .eq("ordemservicoid", ordemservicoid),
  ]);

  if (servicosRes.error) throw servicosRes.error;
  if (realizadoresRes.error) throw realizadoresRes.error;

  const servicoIds = (servicosRes.data ?? []).map((s: any) => Number(s.servicoid));
  if (servicoIds.length === 0) return false;

  const realizadores = realizadoresRes.data ?? [];
  return servicoIds.every((servicoid) => {
    const rows = realizadores.filter((r: any) => Number(r.servicoid) === servicoid);
    return rows.length > 0 && rows.every((r: any) => r.status_execucao === "FINALIZADO");
  });
}

async function enviarParaPagamento(ordemservicoid: number) {
  const now = new Date().toISOString();
  const resumoRes = await supabaseAdmin.rpc("resumo_financeiro_os", {
    p_ordemservicoid: ordemservicoid,
  });
  if (resumoRes.error) throw resumoRes.error;
  const resumo = Array.isArray(resumoRes.data) ? resumoRes.data[0] : resumoRes.data;
  const status = resumo?.quitada === true ? "CONCLUIDO" : "PAGAMENTO";
  const updateRes = await supabaseAdmin
    .from("ordemservico")
    .update({ status, execucao_fim_em: now })
    .eq("id", ordemservicoid);

  if (updateRes.error) throw updateRes.error;
  return { avancou: true, proximoSetorId: null, status };
}

export async function POST(req: Request, ctx: { params: Promise<Params> }) {
  try {
    const session = await getExecucaoSession();
    if (isNextResponse(session)) return session;

    const { id, servicoId } = await ctx.params;
    const ordemservicoid = Number(id);
    const servicoid = Number(servicoId);

    if (!ordemservicoid || !servicoid) {
      return NextResponse.json({ error: "Parametros invalidos." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({} as any));
    const observacao = String(body?.observacao ?? "").trim() || null;

    const osRes = await getOrdemDoSetor(ordemservicoid, session.setorId);
    if (osRes.error) throw osRes.error;
    if (!osRes.data) {
      return NextResponse.json({ error: "OS nao encontrada no seu setor." }, { status: 404 });
    }

    const atualRes = await supabaseAdmin
      .from("osservico_realizador")
      .select("status_execucao")
      .eq("ordemservicoid", ordemservicoid)
      .eq("servicoid", servicoid)
      .eq("usuarioid", session.userId)
      .maybeSingle();

    if (atualRes.error) throw atualRes.error;
    if (!atualRes.data) {
      return NextResponse.json(
        { error: "Inicie sua parte antes de finalizar." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const updateRes = await supabaseAdmin
      .from("osservico_realizador")
      .update({
        status_execucao: "FINALIZADO",
        finalizado_em: now,
        observacao_execucao: observacao,
      })
      .eq("ordemservicoid", ordemservicoid)
      .eq("servicoid", servicoid)
      .eq("usuarioid", session.userId)
      .select(
        `
          ordemservicoid,
          servicoid,
          usuarioid,
          status_execucao,
          iniciado_em,
          finalizado_em,
          observacao_execucao,
          usuario:usuarioid ( id, nome )
        `
      )
      .single();

    if (updateRes.error) throw updateRes.error;

    const ordemCompleta = await calcularConclusaoDaOrdem(ordemservicoid);
    const fluxo = ordemCompleta
      ? await enviarParaPagamento(ordemservicoid)
      : { avancou: false, proximoSetorId: null, status: null };

    return NextResponse.json(
      {
        ok: true,
        item: updateRes.data,
        ordemCompleta,
        fluxo,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: any) {
    console.error("POST /api/execucao/ordens/[id]/servicos/[servicoId]/finalizar", error);
    return NextResponse.json(
      { error: error?.message ?? "Falha ao finalizar execucao" },
      { status: 500 }
    );
  }
}
