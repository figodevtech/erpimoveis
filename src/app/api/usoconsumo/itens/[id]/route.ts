import { NextRequest, NextResponse } from "next/server";
import { requireUsoConsumoAccess, requireUsoConsumoDelete, requireUsoConsumoEdit } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { carregarAutores } from "@/lib/movement-authors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { usoConsumoError } from "@/lib/usoconsumo/api";
import { usoConsumoItemPatchSchema, zodMessage } from "@/lib/usoconsumo/schemas";
import { USOCONSUMO_ITEM_FIELDS } from "@/lib/usoconsumo/fields";

type Context = { params: Promise<{ id: string }> };
async function idOf(context: Context) { const id = Number((await context.params).id); if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error("Item inválido."), { statusCode: 400 }); return id; }

export async function GET(_req: NextRequest, context: Context) {
  try {
    await requireUsoConsumoAccess();
    const id = await idOf(context);
    const [item, entradas, saidas, imagens] = await Promise.all([
      supabaseAdmin.from("usoconsumo_item").select(USOCONSUMO_ITEM_FIELDS).eq("id", id).maybeSingle(),
      supabaseAdmin.from("usoconsumo_entrada_item").select("id,quantidade,valor_unitario_compra,valor_total,saldo_anterior,saldo_resultante,created_at,entrada:usoconsumo_entrada(id,status,origem,fiscal,numero_nota,created_at,created_by,fornecedor:fornecedor(id,nomerazaosocial))").eq("item_id", id).order("created_at", { ascending: false }).limit(100),
      supabaseAdmin.from("usoconsumo_saida_item").select("id,quantidade,saldo_anterior,saldo_resultante,valor_custo_aplicado,created_at,saida:usoconsumo_saida(id,motivo,observacao,status,created_at,created_by)").eq("item_id", id).order("created_at", { ascending: false }).limit(100),
      supabaseAdmin.from("usoconsumo_item_imagem").select("id,item_id,url,ordem,created_at").eq("item_id", id).order("ordem"),
    ]);
    const failure = [item,entradas,saidas,imagens].find((result) => result.error)?.error;
    if (failure) throw failure;
    if (!item.data) return NextResponse.json({ error: "Item não encontrado." }, { status: 404 });

    const entradaLinhas = (entradas.data ?? []) as Array<Record<string, any>>;
    const saidaLinhas = (saidas.data ?? []) as Array<Record<string, any>>;
    const autores = await carregarAutores([
      ...entradaLinhas.map((linha) => linha.entrada?.created_by),
      ...saidaLinhas.map((linha) => linha.saida?.created_by),
    ]);
    const comAutor = (movimento: Record<string, any> | null | undefined) =>
      movimento ? { ...movimento, criador: autores.get(String(movimento.created_by ?? "")) ?? null } : movimento;

    return NextResponse.json({
      data: {
        ...item.data,
        entradas: entradaLinhas.map((linha) => ({ ...linha, entrada: comAutor(linha.entrada) })),
        saidas: saidaLinhas.map((linha) => ({ ...linha, saida: comAutor(linha.saida) })),
        imagens: imagens.data ?? [],
      },
    });
  } catch (error) { return usoConsumoError(error, "Erro ao buscar item."); }
}

export async function PATCH(req: NextRequest, context: Context) {
  try {
    await requireUsoConsumoEdit();
    const parsed = usoConsumoItemPatchSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: zodMessage(parsed.error) }, { status: 400 });
    const session = await auth();
    const { expectedUpdatedAt, ...changes } = parsed.data;
    let query = supabaseAdmin.from("usoconsumo_item").update({
      ...changes, updated_by: (session?.user as { id?: string })?.id ?? null, updated_at: new Date().toISOString(),
    }).eq("id", await idOf(context));
    if (expectedUpdatedAt) query = query.eq("updated_at", expectedUpdatedAt);
    const { data, error } = await query.select(USOCONSUMO_ITEM_FIELDS).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: expectedUpdatedAt ? "O item foi alterado por outra pessoa. Recarregue e tente novamente." : "Item não encontrado." }, { status: expectedUpdatedAt ? 409 : 404 });
    return NextResponse.json({ data });
  } catch (error) { return usoConsumoError(error, "Erro ao editar item."); }
}

export async function DELETE(_req: NextRequest, context: Context) {
  try {
    await requireUsoConsumoDelete();
    const id = await idOf(context);
    const { data: existing, error: findError } = await supabaseAdmin.from("usoconsumo_item").select("id,estoque").eq("id", id).maybeSingle();
    if (findError) throw findError;
    if (!existing) return NextResponse.json({ error: "Item não encontrado." }, { status: 404 });
    if (existing.estoque > 0) return NextResponse.json({ error: "Zere o estoque por uma saída ou ajuste antes de inativar o item." }, { status: 409 });
    const session = await auth();
    const { error } = await supabaseAdmin.from("usoconsumo_item").update({ ativo: false, updated_by: (session?.user as { id?: string })?.id ?? null, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    return new NextResponse(null, { status: 204 });
  } catch (error) { return usoConsumoError(error, "Erro ao inativar item."); }
}
