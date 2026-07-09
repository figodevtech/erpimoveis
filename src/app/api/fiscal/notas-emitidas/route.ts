import { NextResponse, type NextRequest } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import {
  listarNotasEmitidas,
  type FiscalViewMode,
} from "@/services/fiscal/notasEmitidasService";

export const runtime = "nodejs";

function getParam(req: NextRequest, key: string) {
  return req.nextUrl.searchParams.get(key) ?? undefined;
}

export async function GET(req: NextRequest) {
  try {
    await requireFinanceirosAccess();

    const data = await listarNotasEmitidas({
      page: Number(getParam(req, "page") ?? 1),
      limit: Number(getParam(req, "limit") ?? 20),
      search: getParam(req, "search"),
      dateFrom: getParam(req, "dateFrom"),
      dateTo: getParam(req, "dateTo"),
      viewMode: (getParam(req, "viewMode") as FiscalViewMode | undefined) ?? "TODAS",
      status: getParam(req, "status"),
      modelo: getParam(req, "modelo"),
    });

    return NextResponse.json(data);
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        error:
          status === 403
            ? "Você não tem permissão para visualizar notas fiscais."
            : "Erro ao listar notas fiscais.",
        detail: error?.message ?? String(error),
      },
      { status },
    );
  }
}
