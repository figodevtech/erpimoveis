import { NextResponse } from "next/server";
import { z } from "zod";
import { requireConfigEdit } from "@/app/api/_authz/perms";
import { sendFinancialSummaryTest } from "@/lib/financeiro/telegram-daily-summary";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    await requireConfigEdit();
    const parsed = z.object({
      usuarioId: z.string().uuid(),
      tipo: z.enum(["A_PAGAR", "A_RECEBER"]).default("A_PAGAR"),
    }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Destinatário inválido." }, { status: 400 });
    const result = await sendFinancialSummaryTest(parsed.data.usuarioId, parsed.data.tipo);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
    const message = error instanceof Error ? error.message : "Não foi possível enviar o resumo de teste.";
    return NextResponse.json({ error: statusCode === 500 ? message : "Sem permissão." }, { status: statusCode });
  }
}
