import { NextResponse } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { getNFeAvulsaSetup } from "@/services/fiscal/nfeAvulsaService";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireFinanceirosAccess();
    const setup = await getNFeAvulsaSetup();
    return NextResponse.json(setup);
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        error:
          status === 403
            ? "Você não tem permissão para emitir NF-e."
            : "Erro ao carregar dados para emissão avulsa.",
        detail: error?.message ?? String(error),
      },
      { status },
    );
  }
}
