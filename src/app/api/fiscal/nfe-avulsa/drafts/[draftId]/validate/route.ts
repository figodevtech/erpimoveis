import { NextResponse, type NextRequest } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { validarDraftAvulso } from "@/services/fiscal/nfeAvulsaService";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await requireFinanceirosAccess();
    const body = await req.json().catch(() => ({}));
    const errors = validarDraftAvulso(body);

    return NextResponse.json({
      valid: errors.length === 0,
      errors,
      warnings: [],
    });
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        valid: false,
        error:
          status === 403
            ? "Você não tem permissão para validar NF-e."
            : "Erro ao validar NF-e avulsa.",
        detail: error?.message ?? String(error),
      },
      { status },
    );
  }
}
