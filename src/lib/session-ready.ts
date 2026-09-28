export type SessionStatus = "authenticated" | "loading" | "unauthenticated";

export type SessionReadiness = { ready: boolean; userId: string | null };

/**
 * `useSession().update()` troca o status para "loading" e volta para
 * "authenticated", com o mesmo usuario. Efeitos que dependiam do status
 * derrubavam o Realtime do chat, reliam preferencias e recarregavam telas a
 * cada renovacao de permissoes.
 *
 * Aqui "pronto" so muda quando muda de verdade:
 * - `unauthenticated` desliga na hora;
 * - `loading` com a sessao ja carregada (a renovacao) mantem o usuario atual;
 * - `loading` sem sessao (carga inicial) ainda nao esta pronto;
 * - troca de usuario devolve o novo `userId`, o que refaz os efeitos.
 */
export function sessionReadiness(
  status: SessionStatus,
  session: { user?: { id?: string | null } | null } | null | undefined,
): SessionReadiness {
  if (status === "unauthenticated") return { ready: false, userId: null };

  const userId = String(session?.user?.id ?? "").trim() || null;
  if (!userId) return { ready: false, userId: null };

  return { ready: status === "authenticated" || status === "loading", userId };
}
