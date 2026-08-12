import { NextRequest, NextResponse } from "next/server";
import { processDailyFinancialSummaries } from "@/lib/financeiro/telegram-daily-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: NextRequest) {
  const expected = String(process.env.CRON_SECRET ?? "").trim();
  if (!expected) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() === expected;
}

async function processRequest(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const result = await processDailyFinancialSummaries();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[telegram-financeiro-processar]", error);
    return NextResponse.json({ error: "Não foi possível processar os resumos financeiros." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return processRequest(request);
}

export async function POST(request: NextRequest) {
  return processRequest(request);
}
