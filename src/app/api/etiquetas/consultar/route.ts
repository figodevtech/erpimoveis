import { NextRequest, NextResponse } from "next/server";
import { hasPerm, PERMS, requireAny } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { InventoryLabelItem, InventoryLabelKind, InventoryLabelMatch } from "@/lib/inventory-labels";

const PRODUCT_FIELDS = "id,titulo,descricao,referencia,fabricante,codigobarras,etiqueta,local,unidade,estoque,estoqueminimo,status_estoque,imgUrl,updatedat";
const USE_FIELDS = "id,titulo,descricao,referencia,fabricante,codigobarras,etiqueta,local,unidade,estoque,estoqueminimo,status_estoque,img_url,updated_at";

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
      matchBy: byLabel && byBarcode ? "AMBOS" : byLabel ? "ETIQUETA" : "CODIGOBARRAS",
      restricted: !canSee,
      item: canSee ? item : null,
    };
  });
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
      supabaseAdmin.from("produto").select(PRODUCT_FIELDS).ilike("etiqueta", labelPattern).limit(5),
      supabaseAdmin.from("produto").select(PRODUCT_FIELDS).ilike("codigobarras", labelPattern).limit(5),
      supabaseAdmin.from("usoconsumo_item").select(USE_FIELDS).ilike("etiqueta", labelPattern).limit(5),
      supabaseAdmin.from("usoconsumo_item").select(USE_FIELDS).ilike("codigobarras", labelPattern).limit(5),
    ]);

    const queryError = [productLabels, productBarcodes, useLabels, useBarcodes].find((result) => result.error)?.error;
    if (queryError) throw queryError;

    const products = uniqueRows(
      (productLabels.data ?? []) as InventoryLabelItem[],
      (productBarcodes.data ?? []) as InventoryLabelItem[],
    );
    const useItems = uniqueRows(
      (useLabels.data ?? []) as InventoryLabelItem[],
      (useBarcodes.data ?? []) as InventoryLabelItem[],
    );
    const matches = [
      ...mergeMatches("PRODUTO", products, code, canSeeProducts),
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
