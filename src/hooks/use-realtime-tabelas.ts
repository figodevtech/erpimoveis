"use client";

import { useEffect, useRef } from "react";

/**
 * Mantém as telas atualizadas sem abrir acesso direto do navegador às tabelas.
 *
 * A autenticação principal usa NextAuth, portanto o cliente Supabase do browser
 * só teria a chave anônima. Assinar o Postgres Realtime com essa chave exigiria
 * liberar SELECT para `anon`, reabrindo os dados que as APIs protegem. Um polling
 * leve faz as telas recarregarem pelas APIs autenticadas e permite fechar o banco.
 */
const INTERVALO_ATUALIZACAO_MS = 10_000;

export function useRealtimeTabelas(tabelas: string[], aoMudar: () => void) {
  const aoMudarRef = useRef(aoMudar);
  useEffect(() => {
    aoMudarRef.current = aoMudar;
  });

  const chave = [...new Set(tabelas)].sort().join(",");

  useEffect(() => {
    if (!chave) return;

    const atualizarSeVisivel = () => {
      if (document.visibilityState === "visible") aoMudarRef.current();
    };

    const intervalo = window.setInterval(atualizarSeVisivel, INTERVALO_ATUALIZACAO_MS);
    window.addEventListener("focus", atualizarSeVisivel);
    document.addEventListener("visibilitychange", atualizarSeVisivel);

    return () => {
      window.clearInterval(intervalo);
      window.removeEventListener("focus", atualizarSeVisivel);
      document.removeEventListener("visibilitychange", atualizarSeVisivel);
    };
  }, [chave]);
}
