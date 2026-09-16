export type TokenSnapshot = { id: number; access_token: string; expires_at?: string | null };

export function canReuseMercadoLivreToken(account: TokenSnapshot, rejectedToken?: string, now = Date.now()) {
  if (!account.access_token || rejectedToken) return false;
  const expires = Date.parse(account.expires_at ?? "");
  return Number.isFinite(expires) && expires > now + 300_000;
}
