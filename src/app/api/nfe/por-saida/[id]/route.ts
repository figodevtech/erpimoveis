import { NextResponse } from "next/server";

import { requireEstoqueAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireEstoqueAccess();
    const { id: rawId } = await context.params;
    const saidaId = Number(rawId);
    if (!Number.isInteger(saidaId) || saidaId <= 0) {
      return NextResponse.json({ ok: false, message: "Saída inválida." }, { status: 400 });
    }
    const colunas =
      "id, modelo, serie, numero, chave_acesso, ambiente, status, dataemissao, dataautorizacao, protocolo, total_produtos, total_servicos, total_nfe, justificativacancelamento, codigo_rejeicao, motivo_rejeicao, rejeitada_em, ordemservicoid, vendaid, clienteid, empresaid, createdat, updatedat";
    const [{ data: diretas, error: diretasError }, { data: vinculos, error: vinculosError }] = await Promise.all([
      supabaseAdmin
      .from("nfe")
      // Mesmo conjunto de colunas que `por-os` e `por-venda`: a saída lista as
      // notas no mesmo diálogo, e campo faltando aqui vira "—" na tela ou tira
      // uma ação do menu (a justificativa do cancelamento, por exemplo).
      .select(colunas)
      .eq("saidaid", saidaId)
      .eq("is_deleted", false)
      .order("createdat", { ascending: false }),
      supabaseAdmin
        .from("nfe_saida_item_vinculo")
        .select("nfe_id")
        .eq("saida_id", saidaId),
    ]);
    if (diretasError) throw diretasError;
    if (vinculosError) throw vinculosError;

    const vinculadaIds = Array.from(new Set((vinculos ?? []).map((row: any) => Number(row.nfe_id))));
    const { data: vinculadas, error: vinculadasError } = vinculadaIds.length
      ? await supabaseAdmin
          .from("nfe")
          .select(colunas)
          .in("id", vinculadaIds)
          .eq("is_deleted", false)
      : { data: [], error: null };
    if (vinculadasError) throw vinculadasError;

    const porId = new Map<number, any>();
    [...(diretas ?? []), ...(vinculadas ?? [])].forEach((nfe: any) => porId.set(Number(nfe.id), nfe));
    const nfes = Array.from(porId.values()).sort(
      (a, b) => new Date(b.createdat ?? 0).getTime() - new Date(a.createdat ?? 0).getTime(),
    );
    return NextResponse.json({ ok: true, saidaId, nfes });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Erro ao consultar as NF-e da saída." },
      { status: error?.statusCode === 403 ? 403 : 500 },
    );
  }
}
