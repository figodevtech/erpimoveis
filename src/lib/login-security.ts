import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export const MAX_LOGIN_IDENTIFIER_LENGTH = 254;
export const MAX_LOGIN_PASSWORD_LENGTH = 1024;

function firstValidIp(value: string | null): string | null {
  const candidate = value?.split(",")[0]?.trim() ?? "";
  return isIP(candidate) ? candidate : null;
}

export function getClientIp(request: Request): string {
  // Só confie no cabeçalho da Cloudflare quando o origin não puder ser
  // acessado diretamente e essa opção tiver sido habilitada explicitamente.
  if (process.env.TRUST_CLOUDFLARE_PROXY === "true") {
    return firstValidIp(request.headers.get("cf-connecting-ip")) ?? "unknown";
  }

  // Cabeçalhos de IP só são confiáveis quando o proxy que atende a aplicação
  // os sobrescreve. Na Vercel, prefira o cabeçalho próprio da plataforma.
  if (process.env.VERCEL) {
    return (
      firstValidIp(request.headers.get("x-vercel-forwarded-for")) ??
      firstValidIp(request.headers.get("x-forwarded-for")) ??
      "unknown"
    );
  }

  const trustGenericProxy =
    process.env.TRUST_PROXY_HEADERS === "true" || process.env.NODE_ENV !== "production";
  if (trustGenericProxy) {
    return (
      firstValidIp(request.headers.get("x-forwarded-for")) ??
      firstValidIp(request.headers.get("x-real-ip")) ??
      "unknown"
    );
  }

  return "unknown";
}

function hashRateLimitValue(kind: string, value: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET ausente para protecao do login.");

  return `${kind}:${createHmac("sha256", secret).update(value).digest("hex")}`;
}

export function buildLoginRateLimitKeys(identifier: string, request: Request): [string, string, string] {
  return [
    hashRateLimitValue("identifier", identifier),
    hashRateLimitValue("ip", getClientIp(request)),
    hashRateLimitValue("login-global", "v1"),
  ];
}

export function buildPublicApprovalRateLimitKeys(token: string, request: Request): string[] {
  return [
    hashRateLimitValue("approval-token", token),
    hashRateLimitValue("approval-ip", getClientIp(request)),
  ];
}

export function buildChecklistVerificationRateLimitKeys(token: string, request: Request): string[] {
  return [
    hashRateLimitValue("checklist-verification-token", token),
    hashRateLimitValue("checklist-verification-ip", getClientIp(request)),
  ];
}

export function buildChecklistSigningRateLimitKeys(invitationPublicId: string, request: Request): string[] {
  return [
    hashRateLimitValue("checklist-signing-invitation", invitationPublicId),
    hashRateLimitValue("checklist-signing-ip", getClientIp(request)),
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
