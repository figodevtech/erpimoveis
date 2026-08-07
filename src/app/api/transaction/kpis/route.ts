export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import { filtroDeBusca } from "../_lib/busca";

/**
 * Indicadores da aba aberta, sobre o período e os filtros da própria tabela.
 *
 * Endpoint novo em vez de mudar o `status-counter`: aquele compara mês atual com
 * o anterior e é usado como está; misturar as duas leituras numa rota só deixaria
 * as duas piores de entender.
 *
 * Cada aba responde a uma pergunta diferente, então os rótulos vêm daqui junto
 * com os números — a tela não precisa saber a regra de cada visão.
 */

const FORTALEZA = "-03:00";

type Kpi = { rotulo: string; valor: number; tom: "positivo" | "negativo" | "neutro" };

const soma = (linhas: Array<{ valor?: unknown; valorLiquido?: unknown }> | null) =>
  (linhas ?? []).reduce((total, linha) => {
    // O líquido é o que entra ou sai de fato; sem ele, o bruto.
    const liquido = Number(linha.valorLiquido ?? 0);
    const bruto = Number(linha.valor ?? 0);
    const efetivo = Number.isFinite(liquido) && liquido > 0 ? liquido : bruto;
    return total + Math.round((Number.isFinite(efetivo) ? efetivo : 0) * 100);
  }, 0) / 100;

export async function GET(req: NextRequest) {
  try {
    await requireFinanceirosAccess();

    const { searchParams } = new URL(req.url);
    const viewMode = String(searchParams.get("viewMode") ?? "FLUXO");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const search = (searchParams.get("search") ?? "").trim().slice(0, 200);
    // Mesma varredura da lista: o cartão soma exatamente o que a tabela mostra.
    const buscaEm = filtroDeBusca(search);

    /*
     * Os mesmos filtros de relação que a tabela manda para /api/transaction.
     *
     * Sem eles os cartões respondiam sempre pelo período inteiro: filtrar por
     * uma categoria encolhia a lista e deixava o total de tudo em cima dela. O
     * usuário lê o cartão como "o total do que estou vendo", e estava lendo
     * outra coisa.
     */
    const inteiroOuNulo = (valor: string | null) => {
      if (valor == null || valor.trim() === "") return null;
      const numero = Number(valor);
      return Number.isFinite(numero) ? Math.trunc(numero) : null;
    };

    const categoriaId = inteiroOuNulo(searchParams.get("categoriaId"));
    const bancoId = inteiroOuNulo(searchParams.get("bancoId"));
    const planoContaId = inteiroOuNulo(searchParams.get("planoContaId"));
    const centroCustoId = inteiroOuNulo(searchParams.get("centroCustoId"));

    const base = () => {
      let q = supabaseAdmin
        .from("transacao")
        .select('valor, "valorLiquido"')
        .eq("is_deleted", false);

      if (dateFrom) q = q.gte("data", new Date(`${dateFrom}T00:00:00${FORTALEZA}`).toISOString());
      if (dateTo) {
        const fim = new Date(`${dateTo}T00:00:00${FORTALEZA}`);
        fim.setTime(fim.getTime() + 24 * 60 * 60 * 1000);
        q = q.lt("data", fim.toISOString());
      }
      if (buscaEm) q = q.or(buscaEm);
      if (categoriaId != null) q = q.eq("categoria_id", categoriaId);
      if (bancoId != null) q = q.eq("banco_id", bancoId);
      if (planoContaId != null) q = q.eq("plano_de_conta_id", planoContaId);
      if (centroCustoId != null) q = q.eq("centro_custo_id", centroCustoId);
      return q;
    };

    const hoje = new Date(new Date().toISOString().slice(0, 10) + `T00:00:00${FORTALEZA}`).toISOString();
    let kpis: Kpi[] = [];

    if (viewMode === "FLUXO") {
      // Só o que passou por conta: é o extrato, e é o que forma saldo.
      const [entradas, saidas] = await Promise.all([
        base().eq("pendente", false).not("banco_id", "is", null).in("tipo", ["RECEITA", "DEPOSITO"]),
        base().eq("pendente", false).not("banco_id", "is", null).in("tipo", ["DESPESA", "SAQUE"]),
      ]);
      const entrou = soma(entradas.data);
      const saiu = soma(saidas.data);
      kpis = [
        { rotulo: "Entradas", valor: entrou, tom: "positivo" },
        { rotulo: "Saídas", valor: saiu, tom: "negativo" },
        {
          rotulo: "Saldo do período",
          valor: Math.round((entrou - saiu) * 100) / 100,
          tom: entrou - saiu >= 0 ? "positivo" : "negativo",
        },
      ];
    } else if (viewMode === "A_PAGAR" || viewMode === "A_RECEBER") {
      const tipo = viewMode === "A_PAGAR" ? "DESPESA" : "RECEITA";
      const [tudo, vencido] = await Promise.all([
        base().eq("pendente", true).eq("tipo", tipo),
        base().eq("pendente", true).eq("tipo", tipo).lt("data", hoje),
      ]);
      const total = soma(tudo.data);
      const atrasado = soma(vencido.data);
      kpis = [
        {
          rotulo: viewMode === "A_PAGAR" ? "Total a pagar" : "Total a receber",
          valor: total,
          tom: viewMode === "A_PAGAR" ? "negativo" : "positivo",
        },
        { rotulo: "Vencido", valor: atrasado, tom: "negativo" },
        {
          rotulo: "A vencer",
          valor: Math.round((total - atrasado) * 100) / 100,
          tom: "neutro",
        },
      ];
    } else {
      // Liquidadas: tudo que foi baixado, com conta ou sem — inclui os títulos
      // quitados por antecipação, que não aparecem no Fluxo.
      const [recebido, pago] = await Promise.all([
        base().eq("pendente", false).in("tipo", ["RECEITA", "DEPOSITO"]),
        base().eq("pendente", false).in("tipo", ["DESPESA", "SAQUE"]),
      ]);
      const entrou = soma(recebido.data);
      const saiu = soma(pago.data);
      kpis = [
        { rotulo: "Recebido", valor: entrou, tom: "positivo" },
        { rotulo: "Pago", valor: saiu, tom: "negativo" },
        {
          rotulo: "Líquido",
          valor: Math.round((entrou - saiu) * 100) / 100,
          tom: entrou - saiu >= 0 ? "positivo" : "negativo",
        },
      ];
    }

    return NextResponse.json({ data: { viewMode, kpis } });
  } catch (error: unknown) {
    const erro = error as { statusCode?: number; message?: string };
    const status = Number(erro?.statusCode);
    return NextResponse.json(
      { error: erro?.message ?? "Não foi possível carregar os indicadores." },
      { status: status === 401 || status === 403 ? status : 500 },
    );
  }
}
