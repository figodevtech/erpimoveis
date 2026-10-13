export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAlugueisAccess } from "@/app/api/_authz/perms";
import { ABAS_ALUGUEL, filtroDaAba, hojeAluguel, type AbaAluguel } from "@/lib/alugueis/status";
import { respostaDeErro } from "@/lib/alugueis/server";

/** Contador de cada aba, pelo mesmo critério que a lista usa. */
export async function GET() {
  try {
    await requireAlugueisAccess();
    const hoje = hojeAluguel();

    const contagens = await Promise.all(
      ABAS_ALUGUEL.map(async (aba) => {
        const filtro = filtroDaAba(aba, hoje);
        let query = supabaseAdmin
          .from("aluguel")
          .select("id", { count: "exact", head: true })
          .eq("is_deleted", false);
        if (filtro.status) query = query.eq("status", filtro.status);
        if (filtro.limiteDesde) query = query.gte("data_limite", filtro.limiteDesde);
        if (filtro.limiteAntesDe) query = query.lt("data_limite", filtro.limiteAntesDe);
        const { count, error } = await query;
        if (error) throw error;
        return [aba, count ?? 0] as const;
      }),
    );

    return NextResponse.json(Object.fromEntries(contagens) as Record<AbaAluguel, number>);
  } catch (error) {
    return respostaDeErro(error, "Erro ao contar aluguéis.");
  }
}
