export const USERNAME_PATTERN = /^[a-z0-9._-]{3,30}$/;

export function normalizeLoginIdentifier(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isEmailIdentifier(value: string): boolean {
  return value.includes("@");
}

export function normalizeUsername(value: unknown): string {
  return normalizeLoginIdentifier(value);
}

export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value);
}

