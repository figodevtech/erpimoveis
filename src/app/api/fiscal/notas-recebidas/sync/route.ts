import { NextResponse, type NextRequest } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { parsePostgresIntegerId } from "@/lib/postgres-id";
import { sincronizarDfeRecebidas } from "@/services/fiscal/dfeRecebidasService";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await requireFinanceirosAccess();

    const body = await req.json().catch(() => ({}));
    const rawEmpresaId = body?.empresaId;
    const empresaId =
      rawEmpresaId === undefined || rawEmpresaId === null || rawEmpresaId === ""
        ? undefined
        : parsePostgresIntegerId(rawEmpresaId);

    if (empresaId === null) {
      return NextResponse.json(
        {
          success: false,
          error: "ID da empresa inválido.",
          detail: "Informe o ID interno da empresa, não o CNPJ.",
        },
        { status: 400 },
      );
    }
    const confirmCompanyChange = body?.confirmCompanyChange === true;

    const result = await sincronizarDfeRecebidas({ empresaId, confirmCompanyChange });
    return NextResponse.json(result, { status: result.success ? 200 : 409 });
  } catch (error: any) {
    const status =
      error?.statusCode === 403 ? 403 : error?.statusCode === 400 ? 400 : 500;
    return NextResponse.json(
      {
        success: false,
        error:
          status === 403
            ? "Você não tem permissão para sincronizar notas fiscais recebidas."
            : status === 400
              ? "ID da empresa inválido."
              : "Erro ao sincronizar documentos fiscais recebidos.",
        detail: error?.message ?? String(error),
      },
      { status },
    );
  }
}
