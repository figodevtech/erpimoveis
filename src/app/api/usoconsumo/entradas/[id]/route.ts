import { NextResponse } from "next/server";
import { requireUsoConsumoAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { usoConsumoError } from "@/lib/usoconsumo/api";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUsoConsumoAccess();
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Entrada inválida." }, { status: 400 });
    const { data,error } = await supabaseAdmin.from("usoconsumo_entrada")
      .select("*,fornecedor:fornecedor(id,nomerazaosocial,cpfcnpj),itens:usoconsumo_entrada_item(*,item:usoconsumo_item(id,titulo,referencia,unidade)),transacoes:transacao(id,descricao,valor,data,vencimento_em,pendente,is_deleted,origem)")
      .eq("id",id).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Entrada não encontrada." }, { status: 404 });
    return NextResponse.json({ data });
  } catch (error) { return usoConsumoError(error, "Erro ao buscar entrada."); }
}

