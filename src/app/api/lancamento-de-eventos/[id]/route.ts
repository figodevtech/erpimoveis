export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireFinanceiroDelete, requireFinanceirosAccess } from "@/app/api/_authz/perms";
import {
  attachmentPathsForTransactions,
  removeAttachmentObjects,
} from "@/app/api/transaction/_lib/anexos";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Params = { params: Promise<{ id: string }> };

async function lerId(params: Params["params"]) {
  const id = Number((await params).id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Detalhe do lançamento: as parcelas e as despesas que ele quita. */
export async function GET(_: Request, { params }: Params) {
  try {
    await requireFinanceirosAccess();
    const id = await lerId(params);
    if (id == null) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

    const [grupo, parcelas, despesas] = await Promise.all([
      supabaseAdmin
        .from("lancamento_de_eventos")
        .select("id, ordemservicoid, descricao, created_at")
        .eq("id", id)
        .maybeSingle(),
      supabaseAdmin
        .from("transacao")
        .select("id, descricao, valor, data, vencimento_em, pendente, pago_em")
        .eq("lancamento_id", id)
        .eq("is_deleted", false)
        .order("id", { ascending: true }),
      supabaseAdmin
        .from("eventos_financeiros")
        .select("id, descricao, valor, servicoid")
        .eq("lancamento_id", id)
        .order("id", { ascending: true }),
    ]);

    if (grupo.error) throw grupo.error;
    if (!grupo.data) {
      return NextResponse.json({ error: "Lançamento não encontrado." }, { status: 404 });
    }
    if (parcelas.error) throw parcelas.error;
    if (despesas.error) throw despesas.error;

    return NextResponse.json({
      data: {
        ...grupo.data,
        parcelas: parcelas.data ?? [],
        despesas: despesas.data ?? [],
        quantidadeBaixada: (parcelas.data ?? []).filter((p: any) => p.pendente === false).length,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Erro ao carregar o lançamento." },
      { status: Number(error?.statusCode) || 500 },
    );
  }
}

/**
 * Desfaz o lançamento inteiro: somem as parcelas, as despesas voltam a previstas.
 *
 * Não existe desfazer parcial. O boleto é um compromisso só, e tirar uma parcela
 * dele deixaria as despesas quitadas por um valor que ninguém mais deve. As duas
 * guardas — parcela já paga e OS finalizada — vivem na RPC, num lugar só.
 */
export async function DELETE(_: Request, { params }: Params) {
  try {
    await requireFinanceiroDelete();
    const id = await lerId(params);
    if (id == null) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

    // Os caminhos dos anexos precisam ser lidos ANTES: as parcelas caem por
    // CASCADE junto com o grupo, e depois disso não há de onde reler quais
    // objetos ficaram órfãos no bucket.
    const { data: parcelas } = await supabaseAdmin
      .from("transacao")
      .select("id")
      .eq("lancamento_id", id);

    const attachmentPaths = await attachmentPathsForTransactions(
      (parcelas ?? []).map((parcela: any) => Number(parcela.id)),
    );

    const session = await auth().catch(() => null);
    const deletedBy = (session?.user as { id?: string } | undefined)?.id ?? null;

    const { data, error } = await supabaseAdmin.rpc("excluir_lancamento_de_eventos", {
      p_id: id,
      p_deleted_by: deletedBy,
    });

    if (error) {
      // P0001 aqui são as duas guardas: parcela já paga e OS finalizada.
      const status = error.code === "P0001" ? 409 : error.code === "P0002" ? 404 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }

    try {
      await removeAttachmentObjects(attachmentPaths);
    } catch (storageError) {
      // O lançamento já foi desfeito. O bucket é privado; uma falha de limpeza
      // vira log para reconciliação, não uma falsa falha da exclusão.
      console.warn("Falha ao limpar anexos do lançamento excluído", storageError);
    }

    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Erro ao excluir o lançamento." },
      { status: Number(error?.statusCode) || 500 },
    );
  }
}
