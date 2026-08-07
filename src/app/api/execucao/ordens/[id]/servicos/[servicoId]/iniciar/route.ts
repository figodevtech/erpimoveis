export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getExecucaoSession,
  getOrdemDoSetor,
  isNextResponse,
  STATUS_EXECUTAVEIS,
} from "../../../../../_helpers";
import {
  buscarModoBaixaEstoqueOS,
  consumirEstoqueOS,
  mensagemEstoqueInsuficienteOS,
} from "@/lib/ordens/estoque-os";

type Params = { id: string; servicoId: string };

export async function POST(_req: Request, ctx: { params: Promise<Params> }) {
  try {
    const session = await getExecucaoSession();
    if (isNextResponse(session)) return session;

    const { id, servicoId } = await ctx.params;
    const ordemservicoid = Number(id);
    const servicoid = Number(servicoId);

    if (!ordemservicoid || !servicoid) {
      return NextResponse.json({ error: "Parametros invalidos." }, { status: 400 });
    }

    const osRes = await getOrdemDoSetor(ordemservicoid, session.setorId);
    if (osRes.error) throw osRes.error;
    if (!osRes.data) {
      return NextResponse.json({ error: "OS nao encontrada no seu setor." }, { status: 404 });
    }

    const osStatus = String((osRes.data as any).status ?? "").toUpperCase();
    if (!STATUS_EXECUTAVEIS.includes(osStatus as any)) {
      return NextResponse.json(
        { error: "Esta OS nao esta liberada para execucao." },
        { status: 400 }
      );
    }

    const itemRes = await supabaseAdmin
      .from("osservico")
      .select("ordemservicoid, servicoid")
      .eq("ordemservicoid", ordemservicoid)
      .eq("servicoid", servicoid)
      .maybeSingle();

    if (itemRes.error) throw itemRes.error;
    if (!itemRes.data) {
      return NextResponse.json({ error: "Servico nao encontrado na OS." }, { status: 404 });
    }

    const atualRes = await supabaseAdmin
      .from("osservico_realizador")
      .select("status_execucao")
      .eq("ordemservicoid", ordemservicoid)
      .eq("servicoid", servicoid)
      .eq("usuarioid", session.userId)
      .maybeSingle();

    if (atualRes.error) throw atualRes.error;
    if (atualRes.data?.status_execucao === "FINALIZADO") {
      return NextResponse.json(
        { error: "Sua parte nesse servico ja foi finalizada." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    if (osStatus === "ORCAMENTO_APROVADO") {
      // Produto avulso pode fazer parte do orçamento enviado e aprovado pelo
      // cliente, mas precisa ser vinculado ao catálogo antes da execução para
      // que exista um saldo de estoque concreto a consumir.
      const { count: produtosAvulsos, error: produtosAvulsosError } =
        await supabaseAdmin
          .from("osproduto_avulso")
          .select("id", { count: "exact", head: true })
          .eq("ordemservicoid", ordemservicoid);
      if (produtosAvulsosError) throw produtosAvulsosError;
      if ((produtosAvulsos ?? 0) > 0) {
        return NextResponse.json(
          {
            error: `Existem ${produtosAvulsos} produto(s) avulso(s) pendente(s). Vincule ou cadastre antes de iniciar a OS.`,
            codigo: "PRODUTOS_AVULSOS_PENDENTES",
            quantidade: produtosAvulsos,
          },
          { status: 409 },
        );
      }

      const modoBaixa = await buscarModoBaixaEstoqueOS();
      if (modoBaixa === "EXECUCAO") {
        const baixa = await consumirEstoqueOS(ordemservicoid);
        if (!baixa.ok) {
          return NextResponse.json(
            {
              error: mensagemEstoqueInsuficienteOS(baixa.faltantes),
              itens: baixa.faltantes,
            },
            { status: 409 }
          );
        }
      }

      const osUpdate = await supabaseAdmin
        .from("ordemservico")
        .update({ status: "EM_ANDAMENTO", execucao_inicio_em: (osRes.data as any).execucao_inicio_em ?? now })
        .eq("id", ordemservicoid);

      if (osUpdate.error) throw osUpdate.error;
    }

    const payload = {
      ordemservicoid,
      servicoid,
      usuarioid: session.userId,
      status_execucao: "EM_EXECUCAO",
      iniciado_em: atualRes.data ? (undefined as any) : now,
      finalizado_em: null,
    };

    const upsertPayload: any = atualRes.data
      ? {
          ordemservicoid,
          servicoid,
          usuarioid: session.userId,
          status_execucao: "EM_EXECUCAO",
          iniciado_em: now,
          finalizado_em: null,
        }
      : payload;

    const upsertRes = await supabaseAdmin
      .from("osservico_realizador")
      .upsert(upsertPayload, { onConflict: "ordemservicoid,servicoid,usuarioid" })
      .select(
        `
          ordemservicoid,
          servicoid,
          usuarioid,
          status_execucao,
          iniciado_em,
          finalizado_em,
          usuario:usuarioid ( id, nome )
        `
      )
      .single();

    if (upsertRes.error) throw upsertRes.error;

    return NextResponse.json(
      { ok: true, item: upsertRes.data },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: any) {
    console.error("POST /api/execucao/ordens/[id]/servicos/[servicoId]/iniciar", error);
    return NextResponse.json(
      { error: error?.message ?? "Falha ao iniciar execucao" },
      { status: 500 }
    );
  }
}
