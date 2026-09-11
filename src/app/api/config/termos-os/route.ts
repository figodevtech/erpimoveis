export const runtime = "nodejs";
export const revalidate = 0;
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireConfigAccess, requireConfigEdit } from "@/app/api/_authz/perms";
import { normalizarTermo, TERMO_ITENS_MAX, type TermoImpressao } from "@/lib/ordens/termos-impressao";
import { fetchTermosImpressaoOS } from "@/lib/print-termos-os";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/** Teto de blocos: a folha da OS nao comporta mais do que isso, e o limite evita payload absurdo. */
const TERMOS_MAX = 30;

function statusDoErro(error: any) {
  const message = String(error?.message ?? "");
  if (Number(error?.statusCode) === 401 || /não autenticado/i.test(message)) return 401;
  if (Number(error?.statusCode) === 403 || /permissão negada/i.test(message)) return 403;
  return 500;
}

export async function GET() {
  try {
    await requireConfigAccess();
    const { termos, padrao } = await fetchTermosImpressaoOS();
    return NextResponse.json({ termos, padrao });
  } catch (error: any) {
    console.error("[/api/config/termos-os GET] error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Erro ao carregar os dizeres da ordem de serviço" },
      { status: statusDoErro(error) },
    );
  }
}

/**
 * Salva a lista inteira de uma vez — a tela edita tudo em memoria e manda o
 * conjunto final. A troca acontece dentro de `salvar_os_termos_impressao`, para
 * a impressao nunca pegar a tabela no meio da substituicao.
 */
export async function PUT(request: NextRequest) {
  try {
    await requireConfigEdit();

    const body = await request.json().catch(() => null);
    const bruto = body?.termos;
    if (!Array.isArray(bruto)) {
      return NextResponse.json({ error: "Os dizeres devem vir como uma lista." }, { status: 400 });
    }
    if (bruto.length > TERMOS_MAX) {
      return NextResponse.json({ error: `São permitidos no máximo ${TERMOS_MAX} blocos de dizeres.` }, { status: 400 });
    }

    const termos: TermoImpressao[] = [];
    for (const [indice, entrada] of bruto.entries()) {
      const termo = normalizarTermo(entrada, indice + 1);
      if (!termo) {
        return NextResponse.json(
          {
            error:
              `O bloco ${indice + 1} está incompleto: informe o título e ao menos um item ` +
              `(no máximo ${TERMO_ITENS_MAX}).`,
          },
          { status: 400 },
        );
      }
      termos.push(termo);
    }

    const { data, error } = await supabaseAdmin.rpc("salvar_os_termos_impressao", {
      p_termos: termos.map((termo) => ({
        titulo: termo.titulo,
        intro: termo.intro,
        itens: termo.itens,
        status: termo.status,
        alvos: termo.alvos,
      })),
    });
    if (error) throw error;

    const salvos = (data ?? [])
      .map((linha: unknown, indice: number) => normalizarTermo(linha, indice + 1))
      .filter((termo: TermoImpressao | null): termo is TermoImpressao => termo !== null);

    return NextResponse.json({ termos: salvos, padrao: salvos.length === 0 });
  } catch (error: any) {
    console.error("[/api/config/termos-os PUT] error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Erro ao salvar os dizeres da ordem de serviço" },
      { status: statusDoErro(error) },
    );
  }
}
