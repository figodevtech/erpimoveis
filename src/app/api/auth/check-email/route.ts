import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  await req.json().catch(() => ({}));

  // Mantido apenas para clientes antigos. Nunca revela se uma conta existe.
  return NextResponse.json(
    { exists: true },
    { headers: { "Cache-Control": "no-store" } }
  );
}
