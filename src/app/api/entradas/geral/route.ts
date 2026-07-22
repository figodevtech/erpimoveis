import { NextRequest, NextResponse } from "next/server";
import { requireEstoqueCreate } from "@/app/api/_authz/perms";
import { entradaErrorResponse, registrarEntradaConfirmada } from "@/services/estoque/entradaService";

export async function POST(req: NextRequest) {
  try {
    await requireEstoqueCreate();
    const result = await registrarEntradaConfirmada(await req.json(), "MANUAL");
    return NextResponse.json(
      { success: true, entradaId: result.entrada_id, valorTotal: result.valor_total },
      { status: 201 },
    );
  } catch (error: any) {
    const parsed = entradaErrorResponse(error);
    return NextResponse.json({ error: parsed.message }, { status: parsed.status });
  }
}
