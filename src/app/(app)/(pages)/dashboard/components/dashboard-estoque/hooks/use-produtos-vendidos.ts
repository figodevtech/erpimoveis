"use client";

import * as React from "react";

import { formatarDataYYYYMMDD } from "../../shared/datas";
import type { DadosProdutosVendidos } from "../lib/types";

/**
 * Busca o bloco de período da aba, separado da posição atual do estoque.
 *
 * Os dados antigos ficam na tela enquanto a nova busca corre — quem trocou o
 * mês prefere ver o número anterior esmaecido a ver a faixa piscar vazia.
 */
export function useProdutosVendidos(
  endpoint: string,
  { inicio, fim }: { inicio: Date | null; fim: Date | null },
) {
  const [dados, setDados] = React.useState<DadosProdutosVendidos | null>(null);
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState<string | null>(null);

  // Muda a cada resposta: reinicia a animação do gráfico.
  const [animKey, setAnimKey] = React.useState(0);

  const url = React.useMemo(() => {
    if (!inicio || !fim) return null;
    const params = new URLSearchParams({
      dateFrom: formatarDataYYYYMMDD(inicio),
      dateTo: formatarDataYYYYMMDD(fim),
    });
    return `${endpoint}?${params.toString()}`;
  }, [endpoint, inicio, fim]);

  const buscar = React.useCallback(async () => {
    if (!url) {
      setCarregando(false);
      return;
    }

    setCarregando(true);
    setErro(null);
    try {
      const resposta = await fetch(url, { cache: "no-store" });
      const json = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(json?.error || "Falha ao carregar os produtos vendidos.");
      setDados(json as DadosProdutosVendidos);
      setAnimKey((chave) => chave + 1);
    } catch (error: any) {
      setErro(error?.message || "Falha ao carregar os produtos vendidos.");
    } finally {
      setCarregando(false);
    }
  }, [url]);

  // Guarda a última URL para não buscar duas vezes no StrictMode. O valor
  // inicial é um sentinela, não `null`: `null` é uma URL possível (período
  // incompleto) e empataria com ela já no primeiro render, deixando a faixa
  // presa em "carregando".
  const ultimaUrlRef = React.useRef<string | null | undefined>(undefined);
  React.useEffect(() => {
    if (ultimaUrlRef.current === url) return;
    ultimaUrlRef.current = url;
    void buscar();
  }, [url, buscar]);

  return { dados, carregando, erro, recarregar: buscar, animKey };
}
