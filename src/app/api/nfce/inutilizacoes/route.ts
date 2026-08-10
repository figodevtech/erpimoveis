import { NextResponse, type NextRequest } from "next/server";

import { requireEmissaoFiscalAccess } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { exigirModelo, MODELO_NFCE } from "@/lib/nfe/modeloDocumento";
import { modeloParaDb } from "@/lib/nfe/modeloDocumento";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { inutilizarFaixa } from "@/services/fiscal/nfeInutilizacaoService";

export const runtime = "nodejs";

/**
 * Inutilização de faixa de numeração.
 *
 * Serve NFC-e e NF-e — o modelo vem no corpo, com 65 como padrão por ser o caso
 * que motivou o serviço. Inutilizar é declarar que os números nunca viraram
 * documento; para nota que existe na SEFAZ o caminho é o cancelamento.
 */
export async function POST(req: NextRequest) {
  try {
    await requireEmissaoFiscalAccess();
    const session = await auth();

    const body = await req.json().catch(() => ({}));
    const modelo = body?.modelo ? exigirModelo(body.modelo) : MODELO_NFCE;

    const resultado = await inutilizarFaixa({
      modelo,
      serie: Number(body?.serie),
      numeroInicial: Number(body?.numeroInicial),
      numeroFinal: Number(body?.numeroFinal),
      justificativa: String(body?.justificativa ?? ""),
      ano: body?.ano ? Number(body.ano) : undefined,
      usuarioId: (session?.user as { id?: string } | undefined)?.id ?? null,
    });

    if ("errors" in resultado) {
      return NextResponse.json({ ok: false, errors: resultado.errors }, { status: 422 });
    }

    return NextResponse.json(resultado, { status: resultado.ok ? 201 : 422 });
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        ok: false,
        message:
          status === 403
            ? "Você não tem permissão para inutilizar numeração fiscal."
            : "Erro ao inutilizar a faixa de numeração.",
        detalhe: error?.message ?? String(error),
      },
      { status },
    );
  }
}

/** Histórico de inutilizações, para auditoria. */
export async function GET(req: NextRequest) {
  try {
    await requireEmissaoFiscalAccess();

    const modeloParam = req.nextUrl.searchParams.get("modelo");
    let query = supabaseAdmin
      .from("nfe_inutilizacao")
      .select(
        "id, modelo, ambiente, serie, ano, numero_inicial, numero_final, justificativa, status, cstat, motivo, protocolo, createdat",
      )
      .order("id", { ascending: false })
      .limit(100);

    if (modeloParam) query = query.eq("modelo", modeloParaDb(exigirModelo(modeloParam)));

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ ok: true, inutilizacoes: data ?? [] });
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      { ok: false, message: "Erro ao listar as inutilizações.", detalhe: error?.message },
      { status },
    );
  }
}
