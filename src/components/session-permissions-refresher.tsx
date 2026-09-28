"use client";

import * as React from "react";
import { useSession } from "next-auth/react";

import { useSessionReady } from "@/components/use-session-ready";
import { onAppResume } from "@/lib/app-resume";

/** Pior caso de propagacao de permissao alterada: igual ao intervalo anterior. */
const INTERVALO_RENOVACAO_MS = 5 * 60 * 1000;
/**
 * Voltar para a aba renova so se a ultima renovacao tiver mais que isto. Antes,
 * todo foco renovava (usuario + permissoes no banco), mesmo segundos depois.
 */
const INTERVALO_MINIMO_NO_RETORNO_MS = 60 * 1000;

export function SessionPermissionsRefresher() {
  const { update } = useSession();
  const { session, ready, userId } = useSessionReady();
  const updateRef = React.useRef(update);
  const refreshingRef = React.useRef(false);
  const ultimaRenovacaoRef = React.useRef(0);

  React.useEffect(() => {
    updateRef.current = update;
  }, [update]);

  // O servidor carimba a renovacao na sessao; vale tambem a feita em outra aba.
  const carimboDaSessao = Number(session?.user?.permissoesRefreshedAt ?? 0);
  React.useEffect(() => {
    if (carimboDaSessao > ultimaRenovacaoRef.current) ultimaRenovacaoRef.current = carimboDaSessao;
  }, [carimboDaSessao]);

  React.useEffect(() => {
    if (!ready || !userId) return;
    let active = true;

    const refreshPermissions = async (minimoDesdeUltimaMs: number) => {
      if (!active || refreshingRef.current) return;
      if (Date.now() - ultimaRenovacaoRef.current < minimoDesdeUltimaMs) return;
      refreshingRef.current = true;
      ultimaRenovacaoRef.current = Date.now();
      try {
        await updateRef.current();
      } finally {
        refreshingRef.current = false;
      }
    };

    // Carga da pagina: renova se a sessao nao foi renovada ha pouco.
    void refreshPermissions(INTERVALO_MINIMO_NO_RETORNO_MS);

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshPermissions(0);
    }, INTERVALO_RENOVACAO_MS);

    const pararDeOuvir = onAppResume(() => void refreshPermissions(INTERVALO_MINIMO_NO_RETORNO_MS));

    return () => {
      active = false;
      window.clearInterval(interval);
      pararDeOuvir();
    };
  }, [ready, userId]);

  return null;
}
