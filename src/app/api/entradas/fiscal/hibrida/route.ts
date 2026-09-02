import { NextRequest, NextResponse } from "next/server";

import { requireEstoqueCreate, requireUsoConsumoEntrada } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { entradaErrorResponse } from "@/services/estoque/entradaService";
import {
  entradaFiscalHibridaSchema,
  registrarEntradaFiscalHibrida,
} from "@/services/estoque/entradaFiscalHibridaService";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = entradaFiscalHibridaSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((issue) => issue.message).join(" ") },
        { status: 400 },
      );
    }

    const destinos = new Set([
      parsed.data.personalizado.destino,
      ...parsed.data.itensNormais.map((item) => item.destino),
    ]);
    if (destinos.has("ESTOQUE")) await requireEstoqueCreate();
    if (destinos.has("USOCONSUMO") || destinos.has("GERAL")) {
      await requireUsoConsumoEntrada();
    }

    const session = await auth();
    const result = await registrarEntradaFiscalHibrida(
      parsed.data,
      (session?.user as { id?: string })?.id ?? null,
    );

    return NextResponse.json(
      {
        success: true,
        message: "Entrada fiscal hibrida confirmada.",
        entradaId: result.entrada_id,
        usoconsumoEntradaId: result.usoconsumo_entrada_id,
        valorTotal: result.valor_total,
        custoTotalEstoque: result.custo_total_estoque,
        custoPersonalizado: result.custo_personalizado,
      },
      { status: 201 },
    );
  } catch (error: any) {
    const parsed = entradaErrorResponse(error);
    return NextResponse.json({ error: parsed.message }, { status: parsed.status });
  }
}
