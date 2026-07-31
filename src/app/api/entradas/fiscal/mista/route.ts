import { NextRequest, NextResponse } from "next/server";
import { requireEstoqueCreate, requireUsoConsumoEntrada } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { entradaErrorResponse } from "@/services/estoque/entradaService";
import { registrarEntradaFiscalMista } from "@/services/estoque/entradaFiscalMistaService";

export async function POST(req: NextRequest) {
  try {
    // A nota alimenta os dois estoques, entao exige as duas permissoes de criacao.
    await requireEstoqueCreate();
    await requireUsoConsumoEntrada();

    const session = await auth();
    const result = await registrarEntradaFiscalMista(
      await req.json(),
      (session?.user as { id?: string })?.id ?? null,
    );

    return NextResponse.json(
      {
        success: true,
        message: "Entrada fiscal mista confirmada.",
        entradaId: result.entrada_id,
        usoconsumoEntradaId: result.usoconsumo_entrada_id,
        valorTotal: result.valor_total,
      },
      { status: 201 },
    );
  } catch (error: any) {
    const parsed = entradaErrorResponse(error);
    return NextResponse.json({ error: parsed.message }, { status: parsed.status });
  }
}
