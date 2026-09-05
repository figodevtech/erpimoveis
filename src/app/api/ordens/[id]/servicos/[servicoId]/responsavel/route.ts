// /src/app/api/ordens/[id]/servicos/[servicoId]/responsavel/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import {
  CODIGO_REALIZADORES_PENDENTES,
  podeEditarRealizadores,
  podeFicarSemRealizador,
} from "@/lib/ordens/realizadores";
import { mesesDeCompetenciaFechada } from "../../../eventos-financeiros/_lib/competencia";

function uniq(arr: string[]) {
  return [...new Set(arr)];
}

/**
 * Publica (ou encerra) o evento financeiro de comissão dos realizadores.
 *
 * O gatilho `trg_recalc_comissao_realizadores` recalcula o snapshot da linha em
 * `osservico_realizador`, mas quem escreve em `eventos_financeiros` é a
 * reconciliação — e ela só rodava ao salvar o orçamento ou ao encerrar a OS.
 * Resultado: realizador definido depois disso ficava sem evento de comissão até
 * a conclusão, enquanto os serviços já atribuídos na última reconciliação
 * tinham o seu. A condição aqui é a mesma que o orçamento usa.
 */
async function reconciliarComissoes(ordemservicoid: number, status: string) {
  if (!["EM_ANDAMENTO", "PAGAMENTO", "FATURAMENTO"].includes(status)) return null;

  const { data: competencias, error: competenciasError } = await supabase
    .from("eventos_financeiros")
    .select("competencia_em")
    .eq("ordemservicoid", ordemservicoid)
    .neq("status", "CANCELADO")
    .not("competencia_em", "is", null);
  if (competenciasError) throw competenciasError;

  const mesesAfetados = mesesDeCompetenciaFechada(
    (competencias ?? []).map((row: any) => row.competencia_em),
  );

  const { error } = await supabase.rpc("reconciliar_eventos_financeiros_os", {
    p_ordemservicoid: ordemservicoid,
    p_incluir_comissoes: true,
  });
  if (error) throw error;

  return mesesAfetados.length
    ? `Esta OS tem lançamentos com competência em ${mesesAfetados.join(", ")}. ` +
      `A DRE desse período foi recalculada com a comissão atualizada.`
    : null;
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; servicoId: string }> }
) {
  try {
    const { id, servicoId } = await ctx.params;
    const ordemservicoid = Number(id);
    const servicoid = Number(servicoId);

    if (!ordemservicoid || !servicoid) {
      return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({} as any));

    // Aceita novo formato (usuarioIds) OU legado (idusuariorealizador)
    let usuarioIds: string[] = [];

    if (Array.isArray(body?.usuarioIds)) {
      usuarioIds = body.usuarioIds
        .filter((x: any) => typeof x === "string")
        .map((x: string) => x.trim())
        .filter(Boolean);

      usuarioIds = uniq(usuarioIds);
    } else {
      const raw = body?.idusuariorealizador;
      const idusuariorealizador =
        typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
      usuarioIds = idusuariorealizador ? [idusuariorealizador] : [];
    }

    // 1) valida status OS
    const os_res = await supabase
      .from("ordemservico")
      .select("status")
      .eq("id", ordemservicoid)
      .maybeSingle();

    if (os_res.error) throw os_res.error;
    if (!os_res.data) return NextResponse.json({ error: "OS não encontrada" }, { status: 404 });

    const status = String(os_res.data.status || "").toUpperCase();
    if (!podeEditarRealizadores(status)) {
      return NextResponse.json(
        {
          error:
            "Os realizadores só podem ser alterados enquanto a OS não está finalizada.",
        },
        { status: 400 }
      );
    }

    // 2) garante que o item existe em osservico
    const item_res = await supabase
      .from("osservico")
      .select("ordemservicoid, servicoid")
      .eq("ordemservicoid", ordemservicoid)
      .eq("servicoid", servicoid)
      .maybeSingle();

    if (item_res.error) throw item_res.error;
    if (!item_res.data) return NextResponse.json({ error: "Serviço não encontrado na OS" }, { status: 404 });

    // 3) se vier vazio, remove realizadores
    if (usuarioIds.length === 0) {
      // Com a OS em andamento, tirar o último realizador devolve o serviço ao
      // estado que a validação de início existe para impedir. Trocar continua
      // livre: o bloqueio é só para a lista terminar vazia.
      if (!podeFicarSemRealizador(status)) {
        const { count: vinculados, error: vinculadosError } = await supabase
          .from("osservico_realizador")
          .select("usuarioid", { count: "exact", head: true })
          .eq("ordemservicoid", ordemservicoid)
          .eq("servicoid", servicoid);

        if (vinculadosError) throw vinculadosError;
        if ((vinculados ?? 0) > 0) {
          return NextResponse.json(
            {
              error:
                "Não é possível deixar um serviço sem realizador depois que a execução começou. Troque o realizador em vez de remover.",
              codigo: CODIGO_REALIZADORES_PENDENTES,
            },
            { status: 409 },
          );
        }
      }

      const del_res = await supabase
        .from("osservico_realizador")
        .delete()
        .eq("ordemservicoid", ordemservicoid)
        .eq("servicoid", servicoid);

      if (del_res.error) throw del_res.error;

      const aviso = await reconciliarComissoes(ordemservicoid, status);

      return NextResponse.json({
        ordemservicoid,
        servicoid,
        usuarioIds: [],
        idusuariorealizador: null,
        realizadores: [],
        aviso,
      });
    }

    // 4) valida usuários e carrega nomes
    const users_res = await supabase
      .from("usuario")
      .select("id, nome")
      .in("id", usuarioIds);

    if (users_res.error) throw users_res.error;

    const map = new Map((users_res.data ?? []).map((u: any) => [String(u.id), u]));
    const missing = usuarioIds.filter((uid) => !map.has(uid));
    if (missing.length) {
      return NextResponse.json({ error: `Usuários inválidos: ${missing.join(", ")}` }, { status: 400 });
    }

    // 5) atuais
    const atuais_res = await supabase
      .from("osservico_realizador")
      .select("usuarioid")
      .eq("ordemservicoid", ordemservicoid)
      .eq("servicoid", servicoid);

    if (atuais_res.error) throw atuais_res.error;

    const atuais = new Set((atuais_res.data ?? []).map((r: any) => String(r.usuarioid)));
    const novos = new Set(usuarioIds);

    // 6) delete de quem saiu
    const toDelete = [...atuais].filter((uid) => !novos.has(uid));
    if (toDelete.length) {
      const del_some = await supabase
        .from("osservico_realizador")
        .delete()
        .eq("ordemservicoid", ordemservicoid)
        .eq("servicoid", servicoid)
        .in("usuarioid", toDelete);

      if (del_some.error) throw del_some.error;
    }

    // 7) insert só dos novos (sem comissao_percent_aplicada; trigger do banco carimba snapshot)
    // Evita efeito retroativo via upsert (que pode atualizar linha existente em conflito). [web:1104][web:1153]
    const toInsert = usuarioIds.filter((uid) => !atuais.has(uid));
    if (toInsert.length) {
      const insPayload = toInsert.map((uid) => ({
        ordemservicoid,
        servicoid,
        usuarioid: uid,
      }));

      const insRes = await supabase.from("osservico_realizador").insert(insPayload);
      if (insRes.error) throw insRes.error;
    }

    // Entrar ou sair realizador redivide a comissão do serviço; a reconciliação
    // precisa rodar mesmo quando ninguém foi inserido nem removido de fato, para
    // o evento acompanhar o snapshot que o gatilho acabou de reescrever.
    const aviso = await reconciliarComissoes(ordemservicoid, status);

    return NextResponse.json({
      ordemservicoid,
      servicoid,
      usuarioIds,
      idusuariorealizador: usuarioIds[0] ?? null,
      realizadores: usuarioIds.map((uid) => ({
        id: uid,
        nome: map.get(uid)?.nome ?? null,
      })),
      aviso,
    });
  } catch (e: any) {
    console.error("PUT /api/ordens/[id]/servicos/[servicoId]/responsavel", e);

    // A reconciliação recusa mexer em evento que já virou transação: é conflito
    // de estado do usuário, não falha do servidor.
    const conflito = String(e?.message ?? "").includes("eventos convertidos divergentes");

    return NextResponse.json(
      { error: e?.message ?? "Erro ao atualizar responsáveis" },
      { status: conflito ? 409 : 500 },
    );
  }
}
