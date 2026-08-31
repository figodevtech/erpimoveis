import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return chatUnavailable();
}

export async function POST() {
  return chatUnavailable();
}

function chatUnavailable() {
  return NextResponse.json({
    available: false,
    code: "SHOPEE_CHAT_NOT_AVAILABLE",
    error: "A Shopee não aceita novas solicitações de Chat API para aplicativos Third-party Partner desde 18/11/2024. O atendimento deve ser realizado no Seller Center.",
  }, { status: 403 });
}
