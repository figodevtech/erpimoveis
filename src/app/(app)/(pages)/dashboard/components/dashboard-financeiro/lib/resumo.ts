import {
  IDENTIDADE_SEM_CONTA,
  acumularMovimento,
  chaveDoPlano,
  type ChavePlano,
  type MovimentoPorPlanoDeConta,
} from "@/lib/financeiro/plano-contas/movimento-por-conta";

import { ResumoFinanceiro } from "./types";

function chaveDataLocal(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function chaveDataDoFiltro(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function normalizarResumoBruto(json: any, inicio: Date, fim: Date): ResumoFinanceiro {
  const receita = Number(json?.totais?.receita ?? 0);
  const despesa = Number(json?.totais?.despesa ?? 0);
  const saldo = json?.totais?.saldo != null ? Number(json.totais.saldo) : receita - despesa;

  return {
    periodo: {
      inicio: String(json?.periodo?.inicio ?? inicio.toISOString()),
      fim: String(json?.periodo?.fim ?? fim.toISOString()),
    },
    totais: {
      receita,
      despesa,
      saldo,
      receitaPendente: Number(json?.totais?.receitaPendente ?? 0),
    },
    pendencias: {
      aPagar: Number(json?.pendencias?.aPagar ?? 0),
      aPagarVencido: Number(json?.pendencias?.aPagarVencido ?? 0),
      aReceber: Number(json?.pendencias?.aReceber ?? 0),
      aReceberVencido: Number(json?.pendencias?.aReceberVencido ?? 0),
    },
    fluxoDiario: Array.isArray(json?.fluxoDiario)
      ? json.fluxoDiario.map((p: any) => ({
          data: String(p.data),
          receita: Number(p.receita ?? 0),
          despesa: Number(p.despesa ?? 0),
          saldoAcumulado: Number(p.saldoAcumulado ?? 0),
        }))
      : [],
    porCategoria: Array.isArray(json?.porCategoria)
      ? json.porCategoria.map((c: any) => ({
          categoria: String(c.categoria ?? c.nome ?? "Outros"),
          receita: Number(c.receita ?? 0),
          despesa: Number(c.despesa ?? 0),
        }))
      : [],
    porMetodoPagamento: Array.isArray(json?.porMetodoPagamento)
      ? json.porMetodoPagamento.map((m: any) => ({
          metodo: String(m.metodo ?? m.metodopagamento ?? "Não informado"),
          valor: Number(m.valor ?? 0),
        }))
      : [],
    porPlanoDeConta: Array.isArray(json?.porPlanoDeConta)
      ? json.porPlanoDeConta.map((p: any) => ({
          contaId: p.contaId != null ? Number(p.contaId) : null,
          contaCodigo: p.contaCodigo != null ? String(p.contaCodigo) : null,
          contaNome: String(p.contaNome ?? IDENTIDADE_SEM_CONTA.contaNome),
          grupoId: p.grupoId != null ? Number(p.grupoId) : null,
          grupoCodigo: p.grupoCodigo != null ? String(p.grupoCodigo) : null,
          grupoNome: String(p.grupoNome ?? IDENTIDADE_SEM_CONTA.grupoNome),
          receita: Number(p.receita ?? 0),
          despesa: Number(p.despesa ?? 0),
        }))
      : [],
  };
}

/**
 * REGRA:
 * - pendente=true NÃO entra em gráficos/resumo
 * - mas soma em receitaPendente (quando for entrada)
 *
 * `catalogoPlanos` são as linhas do resumo do servidor: filtrar a lista só
 * remove contas, nunca inventa uma nova, então elas bastam para nomear as
 * contas aqui. Sem ele o gráfico de plano de conta fica vazio — que é o certo
 * para as respostas em array cru, que não carregam plano de conta.
 */
export function montarResumoDeLista(
  lista: any[],
  inicio: Date,
  fim: Date,
  catalogoPlanos: MovimentoPorPlanoDeConta[] = [],
): ResumoFinanceiro {
  let receita = 0;
  let despesa = 0;
  let receitaPendente = 0;

  const porDia = new Map<string, { receita: number; despesa: number }>();
  const porCategoria = new Map<string, { receita: number; despesa: number }>();
  const porMetodo = new Map<string, number>();
  const porPlanoDeConta = new Map<ChavePlano, MovimentoPorPlanoDeConta>();
  const identidadePorChave = new Map<ChavePlano, MovimentoPorPlanoDeConta>(
    catalogoPlanos.map((linha) => [chaveDoPlano(linha.contaId), linha]),
  );
  const inicioKey = chaveDataDoFiltro(inicio);
  const fimKey = chaveDataDoFiltro(fim);

  for (const item of lista) {
    const valor = Number(item?.valor ?? 0);
    if (!Number.isFinite(valor) || valor === 0) continue;

    const tipo = String(item?.tipo ?? "").toUpperCase();
    const dataStr: string | undefined = item?.data ?? item?.created_at ?? item?.createdAt ?? item?.data_transacao;
    if (!dataStr) continue;

    const chaveDia = chaveDataLocal(dataStr);
    if (!chaveDia || chaveDia < inicioKey || chaveDia > fimKey) continue;

    const ehEntrada = tipo === "RECEITA" || tipo === "DEPOSITO";
    const ehSaida = tipo === "DESPESA" || tipo === "SAQUE";

    const pendenteFlag = item?.pendente === true || String(item?.pendente).toLowerCase() === "true";
    if (pendenteFlag) {
      if (ehEntrada) receitaPendente += valor;
      continue;
    }

    if (ehEntrada) receita += valor;
    if (ehSaida) despesa += valor;

    const diaAgg = porDia.get(chaveDia) ?? { receita: 0, despesa: 0 };
    if (!porDia.has(chaveDia)) porDia.set(chaveDia, diaAgg);
    if (ehEntrada) diaAgg.receita += valor;
    if (ehSaida) diaAgg.despesa += valor;

    const categoriaRaw =
      item?.categoria ?? item?.categoria_nome ?? item?.categoriatransacao ?? item?.categoriaTransacao;
    const categoria = categoriaRaw ? String(categoriaRaw) : "Outros";
    const catAgg = porCategoria.get(categoria) ?? { receita: 0, despesa: 0 };
    if (!porCategoria.has(categoria)) porCategoria.set(categoria, catAgg);
    if (ehEntrada) catAgg.receita += valor;
    if (ehSaida) catAgg.despesa += valor;

    const chavePlano = chaveDoPlano(item?.plano_de_conta_id);
    const identidadePlano = identidadePorChave.get(chavePlano) ?? {
      ...IDENTIDADE_SEM_CONTA,
      contaId: item?.plano_de_conta_id ?? null,
      contaNome: item?.plano_de_conta ? String(item.plano_de_conta) : IDENTIDADE_SEM_CONTA.contaNome,
    };
    acumularMovimento(porPlanoDeConta, identidadePlano, ehEntrada ? valor : 0, ehSaida ? valor : 0);

    const metodoRaw = item?.metodopagamento ?? item?.metodo_pagamento ?? item?.metodoPagamento;
    const metodo = metodoRaw ? String(metodoRaw) : "Não informado";
    if (ehEntrada) porMetodo.set(metodo, (porMetodo.get(metodo) ?? 0) + valor);
  }

  const saldo = receita - despesa;

  const inicioDia = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate());
  const fimDia = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate());

  const fluxoDiario: ResumoFinanceiro["fluxoDiario"] = [];
  let saldoAcumulado = 0;

  for (let d = new Date(inicioDia.getTime()); d <= fimDia; d.setDate(d.getDate() + 1)) {
    const chaveDia = chaveDataDoFiltro(d);
    const v = porDia.get(chaveDia) ?? { receita: 0, despesa: 0 };
    saldoAcumulado += v.receita - v.despesa;

    fluxoDiario.push({ data: chaveDia, receita: v.receita, despesa: v.despesa, saldoAcumulado });
  }

  return {
    periodo: { inicio: inicio.toISOString(), fim: fim.toISOString() },
    totais: { receita, despesa, saldo, receitaPendente },
    pendencias: { aPagar: 0, aPagarVencido: 0, aReceber: receitaPendente, aReceberVencido: 0 },
    fluxoDiario,
    porCategoria: Array.from(porCategoria.entries()).map(([categoria, v]) => ({ categoria, ...v })),
    porMetodoPagamento: Array.from(porMetodo.entries()).map(([metodo, valor]) => ({ metodo, valor })),
    porPlanoDeConta: Array.from(porPlanoDeConta.values()),
  };
}
