"use client";

import { useEffect, useRef } from "react";
import { useSessionReady } from "@/components/use-session-ready";
import { subscribeOrdensRealtime } from "@/lib/ordens/realtime-client";
import { ORDENS_REALTIME_TABLES } from "@/lib/ordens/realtime-contracts";

// Broadcast privado invalida os dados; as APIs continuam autorizando a leitura.
// A consulta periódica recupera eventos perdidos e atende as demais tabelas.
const INTERVALO_RECONCILIACAO_MS = 60_000;
const INTERVALO_MINIMO_RETORNO_MS = 15_000;

export function useRealtimeTabelas(tabelas: string[], aoMudar: () => void) {
  const { ready, userId } = useSessionReady();
  const aoMudarRef = useRef(aoMudar);
  useEffect(() => { aoMudarRef.current = aoMudar; });
  const chave = [...new Set(tabelas)].sort().join(",");

  useEffect(() => {
    if (!chave) return;
    const ordens = ORDENS_REALTIME_TABLES.filter(table => chave.split(",").includes(table));
    let ultimaAtualizacao = Date.now();
    let pendente = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const atualizarSeVisivel = (intervaloMinimo = 0) => {
      if (document.visibilityState !== "visible") { pendente = true; return; }
      const agora = Date.now();
      if (!pendente && agora - ultimaAtualizacao < intervaloMinimo) return;
      pendente = false;
      ultimaAtualizacao = agora;
      aoMudarRef.current();
    };
    const invalidar = () => {
      pendente = true;
      clearTimeout(debounce);
      debounce = setTimeout(() => atualizarSeVisivel(), 150);
    };
    const reconciliar = () => atualizarSeVisivel(INTERVALO_RECONCILIACAO_MS);
    const atualizarAoRetornar = () => atualizarSeVisivel(INTERVALO_MINIMO_RETORNO_MS);
    const local = () => { clearTimeout(debounce); pendente = true; atualizarSeVisivel(); };
    const unsubscribe = ready && userId && ordens.length
      ? subscribeOrdensRealtime(userId, table => { if (!table || ordens.includes(table)) invalidar(); })
      : undefined;
    const intervalo = window.setInterval(reconciliar, INTERVALO_RECONCILIACAO_MS);
    window.addEventListener("focus", atualizarAoRetornar);
    document.addEventListener("visibilitychange", atualizarAoRetornar);
    if (ordens.length) window.addEventListener("os:refresh", local);
    return () => {
      unsubscribe?.();
      clearTimeout(debounce);
      window.clearInterval(intervalo);
      window.removeEventListener("focus", atualizarAoRetornar);
      document.removeEventListener("visibilitychange", atualizarAoRetornar);
      if (ordens.length) window.removeEventListener("os:refresh", local);
    };
  }, [chave, ready, userId]);
}
