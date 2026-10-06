import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireEstoqueAccess, requireEstoqueEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Exibir no site" do produto e o status de site_product_link: PUBLICADO exibe,
// PAUSADO esconde. Esta rota muda so o status, preservando titulo, preco, slug e
// demais ajustes da publicacao. O trigger do link enfileira a sincronizacao.
const visibilitySchema = z.object({ visible: z.boolean() });

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await requireEstoqueAccess();
    const empresaId = await requireEmpresaId();
    const productId = parseProductId((await context.params).id);
    if (!productId) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from("site_product_link")
      .select("status,sync_status")
      .eq("empresa_id", empresaId)
      .eq("produto_id", productId)
      .maybeSingle();
    if (error) throw error;

    return NextResponse.json({
      data: {
        visible: data?.status === "PUBLICADO",
        status: data?.status ?? "RASCUNHO",
        sync_status: data?.sync_status ?? "NAO_SINCRONIZADO",
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errorMessage(error, "Falha ao carregar a publicação no site.") },
      { status: errorStatus(error) },
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    await requireEstoqueEdit();
    const empresaId = await requireEmpresaId();
    const productId = parseProductId((await context.params).id);
    if (!productId) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

    const parsed = visibilitySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Campo 'visible' deve ser booleano." }, { status: 400 });
    }

    const { data: product, error: productError } = await supabaseAdmin
      .from("produto")
      .select("id")
      .eq("id", productId)
      .eq("is_deleted", false)
      .maybeSingle();
    if (productError) throw productError;
    if (!product) {
      return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
    }

    // O upsert so atualiza as colunas enviadas; as demais ficam como estao.
    const { data, error } = await supabaseAdmin
      .from("site_product_link")
      .upsert(
        {
          empresa_id: empresaId,
          produto_id: productId,
          status: parsed.data.visible ? "PUBLICADO" : "PAUSADO",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "empresa_id,produto_id" },
      )
      .select("status,sync_status")
      .single();
    if (error) throw error;

    return NextResponse.json({
      data: {
        visible: data.status === "PUBLICADO",
        status: data.status,
        sync_status: data.sync_status,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errorMessage(error, "Falha ao alterar a exibição no site.") },
      { status: errorStatus(error) },
    );
  }
}

function parseProductId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
