import { NextRequest, NextResponse } from "next/server";
import { requireEstoqueEdit, requireUsoConsumoCancelar } from "@/app/api/_authz/perms";
import {
  previewCancelamentoEntrada,
  type OrigemEntrada,
} from "@/services/estoque/cancelamentoEntradaPreviewService";

export async function GET(req: NextRequest) {
  try {
    const entradaId = Number(req.nextUrl.searchParams.get("entradaId"));
    const origem = String(req.nextUrl.searchParams.get("origem") ?? "").toUpperCase() as OrigemEntrada;

    if (!Number.isInteger(entradaId) || entradaId <= 0) {
      return NextResponse.json({ error: "Entrada inválida." }, { status: 400 });
    }
    if (origem !== "ESTOQUE" && origem !== "USOCONSUMO") {
      return NextResponse.json({ error: "Origem inválida." }, { status: 400 });
    }

    if (origem === "ESTOQUE") await requireEstoqueEdit();
    else await requireUsoConsumoCancelar();

    const data = await previewCancelamentoEntrada(entradaId, origem);

    // Uma nota mista exige as duas permissoes, porque o cancelamento e conjunto.
    if (data.mista) {
      await requireEstoqueEdit();
      await requireUsoConsumoCancelar();
    }

    return NextResponse.json({ data });
  } catch (error: any) {
    const status = error?.statusCode ?? (error?.code === "P0002" ? 404 : 500);
    return NextResponse.json(
      { error: error?.message ?? "Não foi possível montar a prévia do cancelamento." },
      { status },
    );
  }
}
