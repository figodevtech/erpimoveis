import { NextResponse, type NextRequest } from "next/server";

import { PERMS, requireAny } from "@/app/api/_authz/perms";
import { dataCivilDeHoje } from "@/lib/fiscal-date";
import {
  buscarNcms,
  buscarNcmsPorCodigos,
  LIMITE_MAXIMO_NCM,
  LIMITE_PADRAO_NCM,
} from "@/services/fiscal/ncm/repositorioNcm";

export const runtime = "nodejs";

/**
 * Consulta ao catálogo oficial de NCM para o seletor das telas.
 *
 * A tabela `fiscal_ncm` tem RLS sem policy para anon/authenticated — ninguém a
 * lê direto pelo cliente Supabase. Esta rota é a única porta, e confere
 * permissão antes de responder.
 *
 *   GET /api/fiscal/ncm?q=injecao            busca por trecho da descrição
 *   GET /api/fiscal/ncm?q=903289             busca por código, inclusive parcial
 *   GET /api/fiscal/ncm?q=9032.89.25         pontuação é normalizada
 *   GET /api/fiscal/ncm?q=903289&data=...    vigência numa data específica
 *   GET /api/fiscal/ncm?codigos=a,b,c        rótulos de vários códigos de uma vez
 *
 * A resposta é sempre limitada: o catálogo inteiro nunca vai para o navegador.
 */

function dataFiscal(valor: unknown): string {
  const texto = String(valor ?? "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  // Sem data válida, a de hoje no fuso do emitente — não a do UTC, que depois
  // das 21h já é o dia seguinte e mudaria o recorte de vigência.
  return dataCivilDeHoje();
}

export async function GET(req: NextRequest) {
  try {
    // Quem cadastra produto e quem emite nota precisam do catálogo; a leitura
    // acompanha essas permissões em vez de criar uma nova só para consultar.
    await requireAny([PERMS.ESTOQUE, PERMS.ORDENS, PERMS.VENDAS, PERMS.FINANCEIRO]);

    const params = req.nextUrl.searchParams;
    const data = dataFiscal(params.get("data"));

    // Modo rótulo: a tela manda os códigos que já tem e recebe as descrições
    // numa consulta só, em vez de uma por linha exibida.
    const codigos = params.get("codigos");
    if (codigos) {
      const itens = await buscarNcmsPorCodigos(codigos.split(",").slice(0, LIMITE_MAXIMO_NCM));
      return NextResponse.json(
        { ok: true, items: itens },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const limiteBruto = Number(params.get("limite"));
    const resultado = await buscarNcms({
      termo: params.get("q") ?? "",
      data,
      limite: Number.isFinite(limiteBruto) && limiteBruto > 0 ? limiteBruto : LIMITE_PADRAO_NCM,
    });

    return NextResponse.json(
      {
        ok: true,
        items: resultado.itens,
        codigoInexistente: resultado.codigoInexistente,
        sugestoes: resultado.sugestoes,
        data,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : error?.statusCode === 401 ? 401 : 500;
    return NextResponse.json(
      {
        ok: false,
        error:
          status === 500
            ? "Não foi possível consultar o catálogo NCM."
            : "Você não tem permissão para consultar o catálogo NCM.",
      },
      { status },
    );
  }
}
