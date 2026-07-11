import { NextResponse, type NextRequest } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";

export const runtime = "nodejs";

type Context = { params: Promise<{ draftId: string }> };

export async function POST(req: NextRequest, context: Context) {
  try {
    await requireFinanceirosAccess();
    const { draftId } = await context.params;
    const id = Number(draftId);

    if (!Number.isFinite(id)) {
      return NextResponse.json({ ok: false, error: "ID de rascunho inválido." }, { status: 400 });
    }

    const origin = req.nextUrl.origin;
    const response = await fetch(`${origin}/api/nfe/autorizar/${id}`, {
      method: "POST",
      headers: {
        cookie: req.headers.get("cookie") ?? "",
        "Idempotency-Key": req.headers.get("Idempotency-Key") ?? crypto.randomUUID(),
      },
      cache: "no-store",
    });
    const json = await response.json().catch(() => ({}));

    return NextResponse.json(json, { status: response.status });
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        ok: false,
        error:
          status === 403
            ? "Você não tem permissão para autorizar NF-e."
            : "Erro ao autorizar NF-e avulsa.",
        detail: error?.message ?? String(error),
      },
      { status },
    );
  }
}
