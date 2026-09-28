"use client";

import { useSession } from "next-auth/react";

import { sessionReadiness } from "@/lib/session-ready";

/**
 * Sessao para efeitos que abrem conexao ou buscam dados. Dependa de `ready` e
 * `userId` (primitivos): a renovacao de permissoes nao os altera, logout e troca
 * de usuario alteram na hora.
 */
export function useSessionReady() {
  const { data: session, status } = useSession();
  const { ready, userId } = sessionReadiness(status, session);
  return { session, status, ready, userId };
}
