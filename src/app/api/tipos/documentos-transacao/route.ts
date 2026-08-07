export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Catalogo de tipos de documento que uma transacao pode referenciar.
 *
 * Somente leitura, como o catalogo de acrescimos e descontos: a lista nasce
 * semeada com os documentos do dia a dia (NFS-e, NF-e, recibo, comprovante) e o
 * cadastro de novos e assunto de Configuracoes.
 *
 * `Outro documento` fica por ultimo — e a saida para o que a lista nao previu, e
 * ler antes das opcoes reais so atrapalharia.
 */
export async function GET() {
  try {
    await requireFinanceirosAccess();

    const { data, error } = await supabaseAdmin
      .from("tipos_documento_transacao")
      .select("id, codigo, nome, descricao")
      .eq("ativo", true)
      .order("nome", { ascending: true });

    if (error) throw error;

    const itens = data ?? [];
    const ordenados = [
      ...itens.filter((item) => item.codigo !== "OUTRO"),
      ...itens.filter((item) => item.codigo === "OUTRO"),
    ];

    return NextResponse.json({ data: ordenados });
  } catch (error: unknown) {
    const erro = error as { statusCode?: number; message?: string };
    const status = Number(erro?.statusCode);
    return NextResponse.json(
      { error: erro?.message ?? "Não foi possível carregar os tipos de documento." },
      { status: status === 401 || status === 403 ? status : 500 },
    );
  }
}
