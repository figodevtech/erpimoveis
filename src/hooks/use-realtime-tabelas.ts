"use client";

import { useEffect, useRef } from "react";

// Sem canal de broadcast: a consulta periódica e a volta do foco mantêm a tela
// em dia. As APIs continuam autorizando cada leitura.
const INTERVALO_RECONCILIACAO_MS = 60_000;
const INTERVALO_MINIMO_RETORNO_MS = 15_000;

export function useRealtimeTabelas(tabelas: string[], aoMudar: () => void) {
  const aoMudarRef = useRef(aoMudar);
  useEffect(() => { aoMudarRef.current = aoMudar; });
  const chave = [...new Set(tabelas)].sort().join(",");

  useEffect(() => {
    if (!chave) return;
    let ultimaAtualizacao = Date.now();
    const atualizarSeVisivel = (intervaloMinimo: number) => {
      if (document.visibilityState !== "visible") return;
      const agora = Date.now();
      if (agora - ultimaAtualizacao < intervaloMinimo) return;
      ultimaAtualizacao = agora;
      aoMudarRef.current();
    };
    const reconciliar = () => atualizarSeVisivel(INTERVALO_RECONCILIACAO_MS);
    const atualizarAoRetornar = () => atualizarSeVisivel(INTERVALO_MINIMO_RETORNO_MS);
    const intervalo = window.setInterval(reconciliar, INTERVALO_RECONCILIACAO_MS);
    window.addEventListener("focus", atualizarAoRetornar);
    document.addEventListener("visibilitychange", atualizarAoRetornar);
    return () => {
      window.clearInterval(intervalo);
      window.removeEventListener("focus", atualizarAoRetornar);
      document.removeEventListener("visibilitychange", atualizarAoRetornar);
    };
  }, [chave]);
}
