import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { ok: false, message: "Rota de teste desativada. Use o fluxo autenticado de emissão de NFS-e." },
    { status: 410 },
  );
}
