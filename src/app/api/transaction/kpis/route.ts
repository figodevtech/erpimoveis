export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchAllSupabaseRows } from "@/lib/supabase-pagination";

import { saldoEmAberto } from "@/lib/financeiro/transacao";

import { filtroDeBusca } from "../_lib/busca";
import {
  aplicarRecorteDeAutoria,
  leApenasMinhas,
  recorteDeAutoria,
} from "../_lib/autoria";

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

type Kpi = {
  rotulo: string;
  valor: number;
  tom: "positivo" | "negativo" | "neutro";
  /**
   * O mesmo número no mês anterior. Só existe na visão sem filtro.
   *
   * Comparar um recorte filtrado com "o mês passado inteiro" seria comparar
   * coisas diferentes, e a variação sairia com cara de fato. Filtrou, some.
   */
  comparacao?: { anterior: number; variacao: number | null };
};

/** Primeiro e último instante do mês, no fuso de Fortaleza. */
function limitesDoMes(offsetMeses: number) {
  const agora = new Date();
  const inicio = new Date(
    Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() + offsetMeses, 1, 3, 0, 0),
  );
  const fim = new Date(
    Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() + offsetMeses + 1, 1, 3, 0, 0),
  );
  return { inicio: inicio.toISOString(), fim: fim.toISOString() };
}

/**
 * Quanto variou, em pontos percentuais.
 *
 * Sem base anterior não há variação — dividir por zero daria "infinito por
 * cento", que não informa nada. E num saldo, que troca de sinal, a porcentagem
 * mente: cair de -100 para -50 apareceria como queda de 50%, quando melhorou.
 */
function variacaoPercentual(atual: number, anterior: number): number | null {
  if (!Number.isFinite(anterior) || anterior <= 0) return null;
  return Math.round(((atual - anterior) / anterior) * 1000) / 10;
}

const soma = (linhas: Array<{ valor?: unknown; valorLiquido?: unknown }> | null) =>
  (linhas ?? []).reduce((total, linha) => {
    // O líquido é o que entra ou sai de fato; sem ele, o bruto.
    const liquido = Number(linha.valorLiquido ?? 0);
    const bruto = Number(linha.valor ?? 0);
    const efetivo = Number.isFinite(liquido) && liquido > 0 ? liquido : bruto;
    return total + Math.round((Number.isFinite(efetivo) ? efetivo : 0) * 100);
  }, 0) / 100;

/*
 * Em aberto é o que FALTA, não o valor de face.
 *
 * Um título de R$ 1.000 com R$ 400 já pagos deve R$ 600, e é esse o número que
 * responde "quanto ainda tenho a receber". Somar o cheio contaria de novo o
 * dinheiro que já está na conta — ele entrou pela transação da baixa parcial.
 */
const somaSaldo = (
  linhas: Array<Parameters<typeof saldoEmAberto>[0]> | null,
) =>
  (linhas ?? []).reduce(
    (total, linha) => total + Math.round(saldoEmAberto(linha) * 100),
    0,
  ) / 100;

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
    // E pelo mesmo motivo, o mesmo recorte de autoria: um cartão que soma o
    // caixa inteiro sobre uma lista recortada entrega justamente o número que
    // a lista esconde.
    const recorte = await recorteDeAutoria(leApenasMinhas(searchParams.get("apenasMinhas")));

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
    const metodoPagamento = (
      searchParams.get("metodo") ??
      searchParams.get("metodopagamento") ??
      ""
    ).trim();

    /*
     * O filtro de tipo, que faltava.
     *
     * No Fluxo e em Liquidadas a tela deixa filtrar por RECEITA, DESPESA, SAQUE
     * ou DEPÓSITO, e sem isto os cartões respondiam pelos quatro: filtrar por
     * despesa encolhia a lista e mantinha "Entradas" cheio em cima dela.
     *
     * Nas abas A Pagar e A Receber o tipo já é fixo pela própria aba, e o que
     * vier daqui é ignorado — o `tipo` do ramo delas continua mandando.
     */
    const TIPOS_CONHECIDOS = new Set(["RECEITA", "DESPESA", "SAQUE", "DEPOSITO"]);
    const tipos = (searchParams.get("tipos") ?? "")
      .split(",")
      .map((valor) => valor.trim().toUpperCase())
      .filter((valor) => TIPOS_CONHECIDOS.has(valor));

    /*
     * A visão sem filtro nenhum assume o mês corrente e ganha a comparação com o
     * anterior — era o que os cards antigos mostravam em Fluxo e Liquidadas, e a
     * única pergunta que faz sentido responder quando ninguém recortou nada.
     *
     * Qualquer filtro desliga as duas coisas: os cartões passam a somar o que
     * está na tela, sem período implícito e sem comparação.
     */
    const semFiltro =
      !dateFrom &&
      !dateTo &&
      !search &&
      tipos.length === 0 &&
      categoriaId == null &&
      bancoId == null &&
      planoContaId == null &&
      centroCustoId == null &&
      !metodoPagamento;

    const comparavel = semFiltro && (viewMode === "FLUXO" || viewMode === "LIQUIDADAS");

    const base = (offsetMeses?: number) => {
      let q = supabaseAdmin
        .from("transacao")
        .select('valor, "valorLiquido", valor_descontos, valor_baixado, tipo, pendente')
        .eq("is_deleted", false);

      if (offsetMeses != null) {
        const { inicio, fim } = limitesDoMes(offsetMeses);
        q = q.gte("data", inicio).lt("data", fim);
      }

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
      if (metodoPagamento) q = q.eq("metodopagamento", metodoPagamento);
      if (tipos.length > 0) q = q.in("tipo", tipos);
      // No construtor, nao em cada ramo: FLUXO, A_PAGAR/A_RECEBER e LIQUIDADAS
      // partem todos daqui, e esquecer um deles faria aquele cartao somar um
      // recorte diferente do da tabela.
      q = aplicarRecorteDeAutoria(q, recorte);
      return q;
    };

    // O PostgREST devolve no máximo 1.000 linhas por resposta. Sem paginar, uma
    // aba grande (A Receber sem filtro, um ano de Fluxo) somava só a primeira página.
    const todas = (criar: () => ReturnType<typeof base>) =>
      fetchAllSupabaseRows<NonNullable<Parameters<typeof saldoEmAberto>[0]>>(() =>
        criar().order("id", { ascending: true }),
      );

    const hoje = new Date(new Date().toISOString().slice(0, 10) + `T00:00:00${FORTALEZA}`).toISOString();
    let kpis: Kpi[] = [];

    if (viewMode === "FLUXO") {
      // Só o que passou por conta: é o extrato, e é o que forma saldo.
      const doMes = (offset?: number) =>
        base(offset).eq("pendente", false).not("banco_id", "is", null);

      const mes = comparavel ? 0 : undefined;
      const [entradas, saidas] = await Promise.all([
        todas(() => doMes(mes).in("tipo", ["RECEITA", "DEPOSITO"])),
        todas(() => doMes(mes).in("tipo", ["DESPESA", "SAQUE"])),
      ]);
      const entrou = soma(entradas);
      const saiu = soma(saidas);

      let antes = { entrou: 0, saiu: 0 };
      if (comparavel) {
        const [e, s2] = await Promise.all([
          todas(() => doMes(-1).in("tipo", ["RECEITA", "DEPOSITO"])),
          todas(() => doMes(-1).in("tipo", ["DESPESA", "SAQUE"])),
        ]);
        antes = { entrou: soma(e), saiu: soma(s2) };
      }

      kpis = [
        {
          rotulo: "Entradas",
          valor: entrou,
          tom: "positivo",
          ...(comparavel
            ? { comparacao: { anterior: antes.entrou, variacao: variacaoPercentual(entrou, antes.entrou) } }
            : {}),
        },
        {
          rotulo: "Saídas",
          valor: saiu,
          tom: "negativo",
          ...(comparavel
            ? { comparacao: { anterior: antes.saiu, variacao: variacaoPercentual(saiu, antes.saiu) } }
            : {}),
        },
        {
          // Sem comparação: o saldo troca de sinal, e porcentagem sobre número
          // que vira negativo diz o contrário do que aconteceu.
          rotulo: comparavel ? "Saldo do mês" : "Saldo do período",
          valor: Math.round((entrou - saiu) * 100) / 100,
          tom: entrou - saiu >= 0 ? "positivo" : "negativo",
        },
      ];
    } else if (viewMode === "A_PAGAR" || viewMode === "A_RECEBER") {
      const tipo = viewMode === "A_PAGAR" ? "DESPESA" : "RECEITA";
      /*
       * O título antecipado e ainda em aberto fica de fora da conta.
       *
       * Ele aparece na lista de propósito — a cobrança precisa acompanhar o
       * vencimento e ver se o pagador vai honrar o boleto. Mas o dinheiro dele já
       * entrou, pela antecipação, e somá-lo aqui responderia "tenho isto a
       * receber" sobre um valor que já está na conta.
       *
       * Vale nos três cartões, e não só no total: "A vencer" é calculado como
       * total menos vencido, então tirar de um lado só faria a subtração
       * desandar.
       */
      const emAberto = () =>
        base().eq("pendente", true).eq("tipo", tipo).is("adiantamento_id", null);

      const [tudo, vencido] = await Promise.all([
        todas(emAberto),
        todas(() => emAberto().lt("data", hoje)),
      ]);
      const total = somaSaldo(tudo);
      const atrasado = somaSaldo(vencido);
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
      const doMes = (offset?: number) =>
        base(offset).eq("pendente", false).is("baixa_de_transacao_id", null);

      const mes = comparavel ? 0 : undefined;
      const [recebido, pago] = await Promise.all([
        todas(() => doMes(mes).in("tipo", ["RECEITA", "DEPOSITO"])),
        todas(() => doMes(mes).in("tipo", ["DESPESA", "SAQUE"])),
      ]);
      const entrou = soma(recebido);
      const saiu = soma(pago);

      let antes = { entrou: 0, saiu: 0 };
      if (comparavel) {
        const [r, p2] = await Promise.all([
          todas(() => doMes(-1).in("tipo", ["RECEITA", "DEPOSITO"])),
          todas(() => doMes(-1).in("tipo", ["DESPESA", "SAQUE"])),
        ]);
        antes = { entrou: soma(r), saiu: soma(p2) };
      }

      kpis = [
        {
          rotulo: "Recebido",
          valor: entrou,
          tom: "positivo",
          ...(comparavel
            ? { comparacao: { anterior: antes.entrou, variacao: variacaoPercentual(entrou, antes.entrou) } }
            : {}),
        },
        {
          rotulo: "Pago",
          valor: saiu,
          tom: "negativo",
          ...(comparavel
            ? { comparacao: { anterior: antes.saiu, variacao: variacaoPercentual(saiu, antes.saiu) } }
            : {}),
        },
        {
          rotulo: comparavel ? "Líquido do mês" : "Líquido",
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
