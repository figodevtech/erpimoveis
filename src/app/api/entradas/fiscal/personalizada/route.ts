import { NextRequest, NextResponse } from "next/server";

import { requireEstoqueCreate, requireUsoConsumoEntrada } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { entradaErrorResponse } from "@/services/estoque/entradaService";
import {
  destinoEntradaFiscalPersonalizadaSchema,
  registrarEntradaFiscalPersonalizada,
} from "@/services/estoque/entradaFiscalPersonalizadaService";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const destino = destinoEntradaFiscalPersonalizadaSchema.safeParse(body?.destino);
    if (!destino.success) {
      return NextResponse.json({ error: "Destino da entrada personalizada invalido." }, { status: 400 });
    }

    if (destino.data === "ESTOQUE") await requireEstoqueCreate();
    else await requireUsoConsumoEntrada();

    const session = await auth();
    const result = await registrarEntradaFiscalPersonalizada(
      body,
      (session?.user as { id?: string })?.id ?? null,
    );

    return NextResponse.json(
      {
        success: true,
        message: "Entrada fiscal personalizada confirmada.",
        entradaId: result.entrada_id,
        usoconsumoEntradaId: result.usoconsumo_entrada_id,
        destino: result.destino,
        valorTotal: result.valor_total,
        custoTotalEstoque: result.custo_total_estoque,
      },
      { status: 201 },
    );
  } catch (error: any) {
    const parsed = entradaErrorResponse(error);
    return NextResponse.json({ error: parsed.message }, { status: parsed.status });
  }
}

