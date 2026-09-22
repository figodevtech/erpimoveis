import { NextResponse, type NextRequest } from "next/server";

import { PERMS, requireAny } from "@/app/api/_authz/perms";
import { buscarEmpresaAtual } from "@/services/fiscal/empresaAtual";
import { resolverRegraDifalEmLote } from "@/services/fiscal/difal/resolverRegraDifal";

export const runtime = "nodejs";

/**
 * Resolve o DIFAL dos itens antes de a tela montar o formulário fiscal.
 *
 * A tela manda o que descreve a mercadoria e o destino; a UF do emitente e o
 * CRT vêm do banco, aqui dentro. São eles que decidem incidência (a NA01-20
 * dispensa o grupo para CRT 1 e 4) e alíquota interestadual — deixar que
 * chegassem do cliente seria aceitar que o navegador escolhesse o imposto.
 */

type ItemEntrada = {
  id?: unknown;
  ncm?: unknown;
  cest?: unknown;
  origemMercadoria?: unknown;
  cfop?: unknown;
  cst?: unknown;
  csosn?: unknown;
};

function texto(valor: unknown): string | null {
  const t = String(valor ?? "").trim();
  return t === "" ? null : t;
}

function dataFiscal(valor: unknown): string {
  const t = String(valor ?? "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  // Sem data válida, a do servidor: a regra vigente é a de hoje, não a mais nova.
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  try {
    await requireAny([PERMS.ORDENS, PERMS.VENDAS, PERMS.FINANCEIRO, PERMS.ESTOQUE]);

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ ok: false, error: "Corpo inválido." }, { status: 400 });
    }

    const itens = Array.isArray(body.itens) ? (body.itens as ItemEntrada[]) : [];
    if (itens.length === 0) {
      return NextResponse.json({ ok: true, resolucoes: {} });
    }

    const empresa = await buscarEmpresaAtual();
    if (!empresa?.uf) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "UF do emitente não cadastrada. Sem ela não dá para decidir se a operação é interestadual.",
        },
        { status: 409 },
      );
    }

    const resolucoes = await resolverRegraDifalEmLote(
      {
        ufEmitente: empresa.uf,
        ufDestino: String(body.ufDestino ?? ""),
        dataEmissao: dataFiscal(body.dataEmissao),
        crt: empresa.regimetributario,
        modelo: texto(body.modelo),
        indFinal: (body.indFinal as number | string) ?? 1,
        indIEDest: (body.indIEDest as number | string) ?? 9,
        tpNF: (body.tpNF as number | string) ?? 1,
        finNFe: body.finNFe == null ? undefined : Number(body.finNFe),
        ufEntrega: texto(body.ufEntrega),
        possuiISSQN: Boolean(body.possuiISSQN),
      },
      itens.map((item, indice) => ({
        id: String(item.id ?? indice),
        ncm: texto(item.ncm),
        cest: texto(item.cest),
        origemMercadoria: texto(item.origemMercadoria),
        cfop: texto(item.cfop),
        cst: texto(item.cst),
        csosn: texto(item.csosn),
      })),
    );

    return NextResponse.json(
      { ok: true, ufEmitente: empresa.uf, resolucoes: Object.fromEntries(resolucoes) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : error?.statusCode === 401 ? 401 : 500;
    return NextResponse.json(
      {
        ok: false,
        error:
          status === 500
            ? "Erro ao resolver as regras de DIFAL."
            : "Você não tem permissão para emitir NF-e.",
        detail: error?.message ?? String(error),
      },
      { status },
    );
  }
}
