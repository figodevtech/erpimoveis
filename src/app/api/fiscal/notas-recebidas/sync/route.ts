import { NextResponse, type NextRequest } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { sincronizarDfeRecebidas } from "@/services/fiscal/dfeRecebidasService";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await requireFinanceirosAccess();

    const body = await req.json().catch(() => ({}));
    const empresaId = body?.empresaId ? Number(body.empresaId) : undefined;
    const force = body?.force === true;
    const automatic = body?.automatic === true;
    const confirmCompanyChange = body?.confirmCompanyChange === true;

    const result = await sincronizarDfeRecebidas({ empresaId, force, automatic, confirmCompanyChange });
    return NextResponse.json(result, { status: result.success ? 200 : 409 });
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        success: false,
        error:
          status === 403
            ? "Você não tem permissão para sincronizar notas fiscais recebidas."
            : "Erro ao sincronizar documentos fiscais recebidos.",
        detail: error?.message ?? String(error),
      },
      { status },
    );
  }
}
