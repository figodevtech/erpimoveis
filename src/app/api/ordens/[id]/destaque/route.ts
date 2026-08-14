import { NextRequest, NextResponse } from "next/server";

import { requireOSEdit } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth();
    const sessaoUsuarioId = session?.user?.id;
    if (!sessaoUsuarioId) {
      return NextResponse.json({ error: "N\u00e3o autenticado." }, { status: 401 });
    }
    await requireOSEdit();

    const usuarioPorId = await supabaseAdmin
      .from("usuario")
      .select("id")
      .eq("id", sessaoUsuarioId)
      .maybeSingle();
    if (usuarioPorId.error) throw usuarioPorId.error;

    let usuarioId = usuarioPorId.data?.id ? String(usuarioPorId.data.id) : null;
    if (!usuarioId && session.user.email) {
      const usuarioPorEmail = await supabaseAdmin
        .from("usuario")
        .select("id")
        .eq("email", session.user.email)
        .maybeSingle();
      if (usuarioPorEmail.error) throw usuarioPorEmail.error;
      usuarioId = usuarioPorEmail.data?.id ? String(usuarioPorEmail.data.id) : null;
    }
    if (!usuarioId) {
      return NextResponse.json(
        { error: "O usu\u00e1rio autenticado n\u00e3o foi encontrado no cadastro." },
        { status: 409 },
      );
    }

    const { id } = await context.params;
    const osId = Number(id);
    if (!Number.isInteger(osId) || osId <= 0) {
      return NextResponse.json({ error: "ID da OS inv\u00e1lido." }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body.destacada !== "boolean") {
      return NextResponse.json({ error: "Informe se a OS deve ser destacada." }, { status: 400 });
    }

    const motivo = String(body.motivo ?? "").trim();
    if (motivo.length > 200) {
      return NextResponse.json(
        { error: "O motivo do destaque deve ter no m\u00e1ximo 200 caracteres." },
        { status: 400 },
      );
    }

    const corRecebida = body.cor ?? body.destaque_cor;
    const corValida = corRecebida === "amarelo" ? "amarelo" : "vermelho";

    const { data: destaqueAtual, error: destaqueAtualError } = await supabaseAdmin
      .from("ordemservico")
      .select("id, destacada, destaque_cor, destacada_por, destacada_em")
      .eq("id", osId)
      .maybeSingle();
    if (destaqueAtualError) throw destaqueAtualError;
    if (!destaqueAtual) {
      return NextResponse.json({ error: "OS não encontrada." }, { status: 404 });
    }

    const jaEstavaDestacada = destaqueAtual.destacada === true;

    const patch = body.destacada
      ? {
          destacada: true,
          destaque_motivo: motivo || null,
          destaque_cor: corRecebida ? corValida : ((destaqueAtual as any).destaque_cor || "vermelho"),
          destacada_por: jaEstavaDestacada && destaqueAtual.destacada_por
            ? destaqueAtual.destacada_por
            : usuarioId,
          destacada_em: jaEstavaDestacada && destaqueAtual.destacada_em
            ? destaqueAtual.destacada_em
            : new Date().toISOString(),
        }
      : {
          destacada: false,
          destaque_motivo: null,
          destaque_cor: "vermelho",
          destacada_por: null,
          destacada_em: null,
        };

    const { data, error } = await supabaseAdmin
      .from("ordemservico")
      .update(patch)
      .eq("id", osId)
      .select("id, destacada, destaque_motivo, destaque_cor, destacada_por, destacada_em")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "OS não encontrada." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, destaque: data });
  } catch (error: unknown) {
    const status = Number((error as { statusCode?: number })?.statusCode) || 500;
    console.error("PATCH /api/ordens/[id]/destaque", error);
    return NextResponse.json(
      {
        error:
          status === 403
            ? "Sem permiss\u00e3o para destacar esta OS."
            : "N\u00e3o foi poss\u00edvel atualizar o destaque da OS.",
      },
      { status },
    );
  }
}
