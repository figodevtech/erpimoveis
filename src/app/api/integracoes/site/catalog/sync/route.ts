import { NextResponse } from "next/server";
import { requireEstoqueEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { runStorefrontCatalog } from "@/lib/integrations/storefront-catalog-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    await requireEstoqueEdit();
    const empresaId = await requireEmpresaId();
    const result = await runStorefrontCatalog(empresaId);
    return NextResponse.json({ ok: true, ...result });
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
