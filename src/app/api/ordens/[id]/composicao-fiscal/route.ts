// O que esta OS tem para documentar: produtos, serviços ou os dois.
//
// A tela de emissão precisa disso para decidir quais botões oferecer. Sem a
// resposta ela mostrava NF-e, NFC-e e NFS-e sempre, e numa OS só de mão de obra
// clicar em "NF-e (Produto)" abria o assistente para não achar item nenhum —
// erro que só aparecia depois de duas telas.
//
// Só a contagem, de propósito: quem monta os itens de verdade são
// `produtos-para-nfe` e `servicos-de-os`, e duplicar a montagem aqui só criaria
// duas versões da mesma regra para divergirem.
import { NextResponse } from "next/server";

import { requireOSAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

async function contar(tabela: "osproduto" | "osservico", osId: number) {
  const { count, error } = await supabaseAdmin
    .from(tabela)
    .select("ordemservicoid", { count: "exact", head: true })
    .eq("ordemservicoid", osId);

  if (error) throw error;
  return count ?? 0;
}

export async function GET(_request: Request, context: Context) {
  try {
    await requireOSAccess();
    const { id: rawId } = await context.params;
    const osId = Number(rawId);
    if (!Number.isInteger(osId) || osId <= 0) {
      return NextResponse.json({ ok: false, message: "OS inválida." }, { status: 400 });
    }

    const [produtos, servicos] = await Promise.all([
      contar("osproduto", osId),
      contar("osservico", osId),
    ]);

    return NextResponse.json({ ok: true, osId, produtos, servicos });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Erro ao consultar a composição da OS." },
      { status: error?.statusCode === 403 ? 403 : 500 },
    );
  }
}
