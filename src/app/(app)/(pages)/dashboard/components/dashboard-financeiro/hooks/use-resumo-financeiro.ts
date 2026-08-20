import * as React from "react";
import { RESUMO_INICIAL } from "../lib/constants";
import { formatarDataYYYYMMDD } from "../lib/datas";
import { montarResumoDeLista, normalizarResumoBruto } from "../lib/resumo";
import { ResumoFinanceiro } from "../lib/types";

export function useResumoFinanceiro(
  endpoint: string,
  { inicio, fim, autoAtualizarMs }: { inicio: Date | null; fim: Date | null; autoAtualizarMs?: number }
) {
  const [dados, setDados] = React.useState<ResumoFinanceiro>(RESUMO_INICIAL);
  const [transacoes, setTransacoes] = React.useState<any[]>([]);
  const [carregando, setCarregando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  // força remount/animação
  const [animKey, setAnimKey] = React.useState(0);

  const buscar = React.useCallback(async () => {
    if (!inicio || !fim) {
      setDados(RESUMO_INICIAL);
      setTransacoes([]);
      setAnimKey((k) => k + 1);
      return;
    }

    try {
      setCarregando(true);
      setErro(null);

      // começa zerado (animação)
      setDados(RESUMO_INICIAL);
      setTransacoes([]);

      const params = new URLSearchParams({
        dateFrom: formatarDataYYYYMMDD(inicio),
        dateTo: formatarDataYYYYMMDD(fim),
        limit: "1000",
        pendente: "false",
      });

      const resposta = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" });
      if (!resposta.ok) throw new Error(`Erro HTTP ${resposta.status}`);

      const json = await resposta.json();

      let resumo: ResumoFinanceiro;
      let listaTransacoes: any[] = [];

      if (Array.isArray(json)) {
        listaTransacoes = json;
        resumo = montarResumoDeLista(listaTransacoes, inicio, fim);
      } else if (Array.isArray(json.data)) {
        listaTransacoes = json.data;
        resumo = montarResumoDeLista(listaTransacoes, inicio, fim);
      } else {
        resumo = normalizarResumoBruto(json, inicio, fim);
        listaTransacoes = Array.isArray(json.transacoes) ? json.transacoes : [];
      }

      setDados(resumo);
      setTransacoes(listaTransacoes);
      setAnimKey((k) => k + 1);
    } catch (e: any) {
      setErro(e?.message ?? "Erro ao carregar dados financeiros");
      setDados(RESUMO_INICIAL);
      setTransacoes([]);
      setAnimKey((k) => k + 1);
    } finally {
      setCarregando(false);
    }
  }, [endpoint, inicio, fim]);

  React.useEffect(() => void buscar(), [buscar]);

  React.useEffect(() => {
    if (!autoAtualizarMs) return;
    const id = setInterval(() => void buscar(), autoAtualizarMs);
    return () => clearInterval(id);
  }, [autoAtualizarMs, buscar]);

  return { dados, transacoes, carregando, erro, recarregar: buscar, animKey };
}
