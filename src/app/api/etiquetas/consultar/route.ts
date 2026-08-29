import { NextRequest, NextResponse } from "next/server";
import { hasPerm, PERMS, requireAny } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { InventoryLabelItem, InventoryLabelKind, InventoryLabelMatch } from "@/lib/inventory-labels";
import { parseEscopo } from "@/lib/usoconsumo/escopo";

const PRODUCT_FIELDS = "id,titulo,descricao,referencia,fabricante,codigobarras,etiqueta,local,unidade,estoque,estoqueminimo,status_estoque,precocompra,ultimovalordecompra,imgUrl,updatedat";
const USE_FIELDS = "id,escopo,titulo,descricao,referencia,fabricante,codigobarras,etiqueta,local,unidade,estoque,estoqueminimo,status_estoque,precocompra,ultimovalordecompra,img_url,updated_at";

function normalize(value: unknown) {
  return String(value ?? "").trim().toLocaleUpperCase("pt-BR");
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function uniqueRows(...groups: Array<InventoryLabelItem[]>) {
  const rows = new Map<number, InventoryLabelItem>();
  for (const group of groups) {
    for (const item of group) rows.set(item.id, item);
  }
  return [...rows.values()];
}

function mergeMatches(kind: InventoryLabelKind, rows: InventoryLabelItem[], code: string, canSee: boolean) {
  return rows.map((item): InventoryLabelMatch => {
    const byLabel = normalize(item.etiqueta) === code;
    const byBarcode = normalize(item.codigobarras) === code;
    return {
      kind,
      // Os dois estoques simples dividem a tabela: sem o escopo a UI nao sabe se a
      // etiqueta caiu em uso e consumo ou no geral/avulso.
      escopo: kind === "USOCONSUMO" ? parseEscopo(item.escopo) : null,
      matchBy: byLabel && byBarcode ? "AMBOS" : byLabel ? "ETIQUETA" : "CODIGOBARRAS",
      restricted: !canSee,
      item: canSee ? item : null,
    };
  });
}

async function withLastSaleValue(item: InventoryLabelItem): Promise<InventoryLabelItem> {
  const { data, error } = await supabaseAdmin.rpc("buscar_ultimo_valor_venda_produto", {
    p_produto_id: item.id,
  });
  if (error) throw error;

  const result = Array.isArray(data) ? data[0] : data;
  const value = result?.valor_unitario;
  const parsed = value === null || value === undefined ? null : Number(value);

  return {
    ...item,
    ultimovalordevenda: parsed !== null && Number.isFinite(parsed) ? parsed : null,
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireAny([
      PERMS.ESTOQUE,
      PERMS.ESTOQUE_CRIAR,
      PERMS.ESTOQUE_EDITAR,
      PERMS.USOCONSUMO,
      PERMS.USOCONSUMO_CRIAR,
      PERMS.USOCONSUMO_EDITAR,
    ]);
    const code = normalize(req.nextUrl.searchParams.get("codigo"));
    if (!code || code.length > 200) {
      return NextResponse.json({ error: "Informe uma etiqueta válida." }, { status: 400 });
    }

    const labelPattern = escapeLike(code);
    const [canSeeProducts, canSeeUse, productLabels, productBarcodes, useLabels, useBarcodes] = await Promise.all([
      hasPerm(PERMS.ESTOQUE),
      hasPerm(PERMS.USOCONSUMO),
      supabaseAdmin.from("produto").select(PRODUCT_FIELDS).eq("is_deleted", false).ilike("etiqueta", labelPattern).limit(5),
      supabaseAdmin.from("produto").select(PRODUCT_FIELDS).eq("is_deleted", false).ilike("codigobarras", labelPattern).limit(5),
      supabaseAdmin.from("usoconsumo_item").select(USE_FIELDS).ilike("etiqueta", labelPattern).limit(5),
      supabaseAdmin.from("usoconsumo_item").select(USE_FIELDS).ilike("codigobarras", labelPattern).limit(5),
    ]);

    const queryError = [productLabels, productBarcodes, useLabels, useBarcodes].find((result) => result.error)?.error;
    if (queryError) throw queryError;

    const products = uniqueRows(
      (productLabels.data ?? []) as InventoryLabelItem[],
      (productBarcodes.data ?? []) as InventoryLabelItem[],
    );
    const productsWithLastSale = canSeeProducts
      ? await Promise.all(products.map(withLastSaleValue))
      : products;
    const useItems = uniqueRows(
      (useLabels.data ?? []) as InventoryLabelItem[],
      (useBarcodes.data ?? []) as InventoryLabelItem[],
    );
    const matches = [
      ...mergeMatches("PRODUTO", productsWithLastSale, code, canSeeProducts),
      ...mergeMatches("USOCONSUMO", useItems, code, canSeeUse),
    ];
    const status = matches.length > 1 ? "CONFLICT" : matches.length === 1 ? "FOUND" : "AVAILABLE";

    return NextResponse.json({ data: { code, status, matches } });
  } catch (error) {
    const value = error as { message?: string; statusCode?: number };
    return NextResponse.json(
      { error: value?.message ?? "Não foi possível consultar a etiqueta." },
      { status: Number.isInteger(value?.statusCode) ? Number(value.statusCode) : 500 },
    );
  }
}
