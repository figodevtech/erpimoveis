export type SupabaseRefreshFailure = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
};

const TERMINAL_CODES = new Set([
  "refresh_token_not_found",
  "invalid_refresh_token",
]);

export function isTerminalSupabaseRefreshFailure(error: unknown) {
  const failure = (error && typeof error === "object" ? error : {}) as SupabaseRefreshFailure;
  const code = String(failure.code ?? "").trim().toLowerCase();
  const message = String(failure.message ?? error ?? "").trim().toLowerCase();
  if (TERMINAL_CODES.has(code)) return true;
  return message.includes("refresh token not found")
    || message.includes("invalid refresh token")
    || message.includes("refresh token is expired")
    || message.includes("refresh token revoked");
}

export function supabaseRefreshRetryDelayMs(failures: number) {
  const safeFailures = Math.max(1, Math.min(Math.trunc(failures), 6));
  return Math.min(15_000 * (2 ** (safeFailures - 1)), 5 * 60_000);
}
