import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireVendasEdit } from "@/app/api/_authz/perms";

export const runtime = "nodejs";
export const revalidate = 0;

const EXPIRACAO_HORAS = 48;

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    await requireVendasEdit();
    const vendaId = Number((await context.params).id);
    if (!Number.isInteger(vendaId) || vendaId <= 0) {
      return NextResponse.json({ error: "Venda inválida." }, { status: 400 });
    }

    const session = await auth();
    const usuarioId = String((session?.user as any)?.id ?? "") || null;
    const agora = new Date();
    const novoToken = randomUUID();
    const novaExpiracao = new Date(
      agora.getTime() + EXPIRACAO_HORAS * 60 * 60 * 1000,
    ).toISOString();
    const preparacao = await supabaseAdmin.rpc("preparar_venda_para_aprovacao", {
      p_venda_id: vendaId,
      p_novo_token: novoToken,
      p_expira_em: novaExpiracao,
      p_usuario_id: usuarioId,
    });
    if (preparacao.error) throw preparacao.error;

    const resultado = (preparacao.data ?? {}) as Record<string, unknown>;
    const token = String(resultado.token ?? "");
    const expiraEm = String(resultado.expiraEm ?? novaExpiracao);
    const reutilizado = Boolean(resultado.reutilizado);
    if (!token) throw new Error("O banco não retornou o token de aprovação.");

    const url = new URL(request.url);
    url.pathname = `/venda/${token}`;
    url.search = "";
    url.hash = "";

    return NextResponse.json({
      ok: true,
      token,
      expiraEm,
      reutilizado,
      url: url.toString(),
    });
  } catch (error: any) {
    console.error("POST /api/venda/[id]/aprovacao/link", error);
    const message = error?.message || "Falha ao gerar o link de aprovação.";
    const status = String(error?.code) === "P0002"
      ? 404
      : String(error?.code) === "22023"
        ? 409
        : Number(error?.statusCode) || 500;
    return NextResponse.json({ error: message }, { status });
  }
}
