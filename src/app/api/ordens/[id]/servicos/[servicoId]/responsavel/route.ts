// /src/app/api/ordens/[id]/servicos/[servicoId]/responsavel/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";

function uniq(arr: string[]) {
  return [...new Set(arr)];
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
    if (status !== "ORCAMENTO_APROVADO" && status !== "EM_ANDAMENTO") {
      return NextResponse.json(
        {
          error:
            "Só é possível definir responsáveis quando a OS está em ORCAMENTO_APROVADO ou EM_ANDAMENTO.",
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
      const del_res = await supabase
        .from("osservico_realizador")
        .delete()
        .eq("ordemservicoid", ordemservicoid)
        .eq("servicoid", servicoid);

      if (del_res.error) throw del_res.error;

      return NextResponse.json({
        ordemservicoid,
        servicoid,
        usuarioIds: [],
        realizadores: [],
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

    return NextResponse.json({
      ordemservicoid,
      servicoid,
      usuarioIds,
      realizadores: usuarioIds.map((uid) => ({
        id: uid,
        nome: map.get(uid)?.nome ?? null,
      })),
    });
  } catch (e: any) {
    console.error("PUT /api/ordens/[id]/servicos/[servicoId]/responsavel", e);
    return NextResponse.json({ error: e?.message ?? "Erro ao atualizar responsáveis" }, { status: 500 });
  }
}
