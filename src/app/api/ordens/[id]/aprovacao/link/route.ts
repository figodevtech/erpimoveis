import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { randomUUID } from "crypto";

export const revalidate = 0;

type StatusOS =
  | "ORCAMENTO"
  | "APROVACAO_ORCAMENTO"
  | "EM_ANDAMENTO"
  | "PAGAMENTO"
  | "FATURAMENTO"
  | "SEM_COBRANCA"
  | "CONCLUIDO"
  | "CANCELADO";

const EXPIRACAO_HORAS = 48;

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const osId = Number(id);
    if (!osId) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

    // já existe token válido?
    const { data: os, error: osErr } = await supabase
      .from("ordemservico")
      .select("id, clienteid")
      .eq("id", osId)
      .maybeSingle();

    if (osErr) throw osErr;
    if (!os?.id) return NextResponse.json({ error: "OS não encontrada." }, { status: 404 });
    if (os.clienteid == null) {
      return NextResponse.json(
        { error: "Selecione um cliente antes de gerar o link de aprovação." },
        { status: 400 }
      );
    }

    const agora = new Date();
    const { data: existente, error: e1 } = await supabase
      .from("osaprovacao")
      .select("id, token, expira_em, usado_em, created_at")
      .eq("ordemservicoid", osId)
      .is("usado_em", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (e1) throw e1;

    let token: string;
    let expira_em: string;

    if (existente && (!existente.expira_em || new Date(existente.expira_em).getTime() > agora.getTime())) {
      token = existente.token;
      expira_em = existente.expira_em ?? "";
    } else {
      token = randomUUID();
      const expiraDt = new Date(agora.getTime() + EXPIRACAO_HORAS * 60 * 60 * 1000);
      expira_em = expiraDt.toISOString();

      const { error: eIns } = await supabase
        .from("osaprovacao")
        .insert({ ordemservicoid: osId, token, expira_em });

      if (eIns) throw eIns;

      // ao gerar o link, muda status para APROVACAO_ORCAMENTO
      const { error: eUpd } = await supabase
        .from("ordemservico")
        .update({ status: "APROVACAO_ORCAMENTO" as StatusOS })
        .eq("id", osId);

      if (eUpd) throw eUpd;
    }

    const base = new URL(request.url);
    base.pathname = `/os/${token}`; // sua página pública: /app/(pages)/os/[token]
    base.search = "";
    base.hash = "";

    return NextResponse.json({ ok: true, token, expira_em, url: base.toString() });
  } catch (err: any) {
    console.error("GET /api/ordens/[id]/aprovacao/link", err);
    return NextResponse.json({ error: "Falha ao gerar link" }, { status: 500 });
  }
}
