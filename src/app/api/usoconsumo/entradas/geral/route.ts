import { NextRequest, NextResponse } from "next/server";
import { requireUsoConsumoEntrada } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { usoConsumoError } from "@/lib/usoconsumo/api";
import { registrarEntradaUsoConsumo } from "@/services/usoconsumo/entradaService";

export async function POST(req: NextRequest) {
  try {
    await requireUsoConsumoEntrada();
    const session = await auth();
    const data = await registrarEntradaUsoConsumo(await req.json(), (session?.user as { id?: string })?.id ?? null, { origem: "MANUAL", fiscal: false });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) { return usoConsumoError(error, "Erro ao registrar entrada manual."); }
}

