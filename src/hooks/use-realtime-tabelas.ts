"use client";

import { useEffect, useRef } from "react";

/**
 * Mantém as telas atualizadas sem abrir acesso direto do navegador às tabelas.
 *
 * A autenticação principal usa NextAuth, portanto o cliente Supabase do browser
 * só teria a chave anônima. Assinar o Postgres Realtime com essa chave exigiria
 * liberar SELECT para `anon`, reabrindo os dados que as APIs protegem. Uma
 * reconciliação periódica pelas APIs autenticadas mantém as telas consistentes;
 * ações feitas neste navegador continuam disparando os eventos locais imediatos.
 */
const INTERVALO_RECONCILIACAO_MS = 60_000;
const INTERVALO_MINIMO_RETORNO_MS = 15_000;

export function useRealtimeTabelas(tabelas: string[], aoMudar: () => void) {
  const aoMudarRef = useRef(aoMudar);
  useEffect(() => {
    aoMudarRef.current = aoMudar;
  });

  const chave = [...new Set(tabelas)].sort().join(",");

  useEffect(() => {
    if (!chave) return;
    let ultimaAtualizacao = Date.now();

    const atualizarSeVisivel = (intervaloMinimo = 0) => {
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
