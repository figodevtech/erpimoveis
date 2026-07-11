import { NextResponse, type NextRequest } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { salvarNFeAvulsaDraft } from "@/services/fiscal/nfeAvulsaService";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await requireFinanceirosAccess();
    const body = await req.json().catch(() => ({}));
    const result = await salvarNFeAvulsaDraft(body);

    if (!result.ok) {
      return NextResponse.json(result, { status: 422 });
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        ok: false,
        error:
          status === 403
            ? "Você não tem permissão para criar rascunho de NF-e."
            : "Erro ao salvar rascunho de NF-e avulsa.",
        detail: error?.message ?? String(error),
      },
      { status },
    );
  }
}
