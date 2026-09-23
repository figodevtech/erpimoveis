"use client";

import * as React from "react";

import { obterPeriodoInicial, formatarDataCompleta } from "./datas";
import type { PeriodoDashboard } from "./periodo";

/**
 * O par de datas do filtro de período de um dashboard.
 *
 * Estado local, não URL nem store: cada aba tem o seu recorte e o Radix Tabs
 * desmonta a aba inativa de qualquer forma. É o mesmo comportamento das abas de
 * OS e Financeiro, agora num lugar só.
 */
export function usePeriodo() {
  const periodoInicial = React.useMemo(() => obterPeriodoInicial(), []);
  const [dataInicio, setDataInicio] = React.useState<Date | null>(periodoInicial.inicio);
  const [dataFim, setDataFim] = React.useState<Date | null>(periodoInicial.fim);
  const [filtroAberto, setFiltroAberto] = React.useState(false);

  // Escolher uma data que inverte o intervalo arrasta a outra junto, em vez de
  // deixar o usuário com um período impossível e a API respondendo 400.
  const tratarDataInicio = React.useCallback((data?: Date) => {
    if (!data) return setDataInicio(null);
    setDataFim((fim) => (fim && data > fim ? data : fim));
    setDataInicio(data);
  }, []);

  const tratarDataFim = React.useCallback((data?: Date) => {
    if (!data) return setDataFim(null);
    setDataInicio((inicio) => (inicio && data < inicio ? data : inicio));
    setDataFim(data);
  }, []);

  const aplicarPeriodo = React.useCallback((periodo: PeriodoDashboard) => {
    setDataInicio(periodo.inicio);
    setDataFim(periodo.fim);
  }, []);

  // "Limpar" é voltar ao mês atual: dashboard sem período não mostra nada.
  const limparFiltros = React.useCallback(() => {
    aplicarPeriodo(obterPeriodoInicial());
  }, [aplicarPeriodo]);

  const textoPeriodo =
    dataInicio && dataFim
      ? `${formatarDataCompleta(dataInicio)} - ${formatarDataCompleta(dataFim)}`
      : "Período não definido";

  return {
    dataInicio,
    dataFim,
    filtroAberto,
    setFiltroAberto,
    tratarDataInicio,
    tratarDataFim,
    aplicarPeriodo,
    limparFiltros,
    textoPeriodo,
  };
}
