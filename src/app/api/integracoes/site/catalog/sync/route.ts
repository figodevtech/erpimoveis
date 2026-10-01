import { NextResponse } from "next/server";
import { requireEstoqueEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { syncStorefrontCatalog } from "@/lib/integrations/storefront-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await requireEstoqueEdit();
    const empresaId = await requireEmpresaId();
    let processed = 0;
    let categories = 0;
    let products = 0;
    for (let batch = 0; batch < 25; batch += 1) {
      const result = await syncStorefrontCatalog(empresaId);
      processed += result.processed;
      categories = Math.max(categories, result.categories);
      products += result.products;
      if (result.processed === 0) break;
    }
    return NextResponse.json({ ok: true, processed, categories, products });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message
            ? error.message
            : "Falha ao sincronizar o catálogo com a loja.",
      },
      { status: errorStatus(error) },
    );
  }
}
