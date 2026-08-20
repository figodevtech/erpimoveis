import { createHmac } from "node:crypto";

export const MAX_LOGIN_IDENTIFIER_LENGTH = 254;
export const MAX_LOGIN_PASSWORD_LENGTH = 1024;

export function getClientIp(request: Request): string {
  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp;

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwarded = request.headers.get("x-forwarded-for");
  const firstForwardedIp = forwarded?.split(",")[0]?.trim();
  return firstForwardedIp || "unknown";
}

function hashRateLimitValue(kind: string, value: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET ausente para protecao do login.");

  return `${kind}:${createHmac("sha256", secret).update(value).digest("hex")}`;
}

export function buildLoginRateLimitKeys(identifier: string, request: Request): string[] {
  return [
    hashRateLimitValue("identifier", identifier),
    hashRateLimitValue("ip", getClientIp(request)),
  ];
}

export function buildPublicApprovalRateLimitKeys(token: string, request: Request): string[] {
  return [
    hashRateLimitValue("approval-token", token),
    hashRateLimitValue("approval-ip", getClientIp(request)),
  ];
}

export function buildRecoveryRateLimitKeys(email: string, request: Request): string[] {
  return [
    hashRateLimitValue("recovery-email", email),
    hashRateLimitValue("recovery-ip", getClientIp(request)),
  ];
}

export function buildAppointmentRateLimitKeys(document: string, request: Request): string[] {
  return [
    hashRateLimitValue("appointment-document", document),
    hashRateLimitValue("appointment-ip", getClientIp(request)),
  ];
}

export function credentialsHaveSafeLength(identifier: string, password: string): boolean {
  return (
    identifier.length > 0 &&
    identifier.length <= MAX_LOGIN_IDENTIFIER_LENGTH &&
    password.length > 0 &&
    password.length <= MAX_LOGIN_PASSWORD_LENGTH
  );
}
