import { NextRequest, NextResponse } from "next/server";
import { requireEstoqueCreate } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { entradaErrorResponse, registrarEntradaConfirmada } from "@/services/estoque/entradaService";

export async function POST(req: NextRequest) {
  try {
    await requireEstoqueCreate();
    const session = await auth();
    const body = await req.json();
    const result = await registrarEntradaConfirmada(
      body,
      "NFE_TERCEIRO",
      (session?.user as { id?: string })?.id ?? null,
    );
    return NextResponse.json(
      { success: true, message: "Entrada fiscal confirmada.", entradaId: result.entrada_id, valorTotal: result.valor_total },
      { status: 201 },
    );
  } catch (error: any) {
    const parsed = entradaErrorResponse(error);
    return NextResponse.json({ error: parsed.message }, { status: parsed.status });
  }
}
