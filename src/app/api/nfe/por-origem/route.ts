// Notas fiscais de um conjunto de origens do mesmo tipo.
//
// É o que a emissão em lote consulta antes de emitir: dado o grupo de OS ou de
// vendas selecionado, quais notas já cobrem alguma delas. Cada nota volta com
// TODAS as origens que documenta — inclusive as que estão fora da seleção —,
// porque é isso que permite avisar "esta nota também cobre a OS #99".

import { NextResponse, type NextRequest } from "next/server";

import { requireEmissaoFiscalAccess } from "@/app/api/_authz/perms";
import {
  lerIdsDaQuery,
  listarNotasPorOrigem,
  type TipoOrigemNota,
} from "@/services/fiscal/notasPorOrigemService";

export const runtime = "nodejs";

const TIPOS_VALIDOS: TipoOrigemNota[] = ["OS", "VENDA", "ENTRADA", "SAIDA"];

export async function GET(req: NextRequest) {
  try {
    await requireEmissaoFiscalAccess();

    const { searchParams } = new URL(req.url);
    const tipo = String(searchParams.get("tipo") ?? "").trim().toUpperCase() as TipoOrigemNota;

    if (!TIPOS_VALIDOS.includes(tipo)) {
      return NextResponse.json(
        { ok: false, message: "Informe o tipo da origem: OS, VENDA, ENTRADA ou SAIDA." },
        { status: 400 },
      );
    }

    const ids = lerIdsDaQuery(searchParams);
    if (ids.length === 0) {
      return NextResponse.json(
        { ok: false, message: "Informe ao menos uma origem em `ids`." },
        { status: 400 },
      );
    }

    const nfes = await listarNotasPorOrigem(tipo, ids);

    return NextResponse.json(
      { ok: true, tipo, ids, nfes },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    console.error("[GET /api/nfe/por-origem]", error);
    return NextResponse.json(
      {
        ok: false,
        message:
          status === 403
            ? "Você não tem permissão para consultar notas fiscais."
            : "Erro ao buscar as notas fiscais das origens.",
        detalhe: error?.message ?? String(error),
      },
      { status },
    );
  }
}
