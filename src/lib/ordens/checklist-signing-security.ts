import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import type { ChecklistConviteStatus } from "./checklist-documento";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PASSWORD_PATTERN = /^\d{4,8}$/;
const SCRYPT_PARAMETERS = { version: 1, N: 16_384, r: 8, p: 1, keyLength: 32 } as const;

type InvitationTokenPayload = {
  v: 1;
  i: string;
  d: string;
  e: number;
};

export type ChecklistSigningSession = {
  v: 1;
  i: string;
  d: string;
  c: string;
  e: number;
};

function secret() {
  const value = String(process.env.CHECKLIST_SIGNING_SECRET ?? "").trim();
  if (value.length < 32) {
    throw new Error("CHECKLIST_SIGNING_SECRET deve possuir pelo menos 32 caracteres.");
  }
  return value;
}

function hmac(label: string, value: string) {
  return createHmac("sha256", secret()).update(`${label}\0${value}`).digest("hex");
}

function equalText(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function encodePayload(value: object) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signPayload(kind: string, payload: object) {
  const encoded = encodePayload(payload);
  return `${encoded}.${hmac(kind, encoded)}`;
}

function verifyPayload<T>(kind: string, token: string): T | null {
  if (!token || token.length > 2_048) return null;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra || !equalText(signature, hmac(kind, encoded))) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function cpfInvitationHmac(cpf: string) {
  return hmac("checklist-cpf-v1", cpf);
}

export function encryptInvitationCpf(cpf: string) {
  const iv = randomBytes(12);
  const key = Buffer.from(hmac("checklist-cpf-encryption-key-v1", "key"), "hex");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(cpf, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${encrypted.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

export function decryptInvitationCpf(value: string) {
  const [version, ivEncoded, encryptedEncoded, tagEncoded, extra] = String(value ?? "").split(".");
  if (version !== "v1" || !ivEncoded || !encryptedEncoded || !tagEncoded || extra) {
    throw new Error("CPF protegido do convite é inválido.");
  }
  const key = Buffer.from(hmac("checklist-cpf-encryption-key-v1", "key"), "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivEncoded, "base64url"));
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedEncoded, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function scrypt(password: string, salt: Buffer, parameters = SCRYPT_PARAMETERS) {
  return new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(password, salt, parameters.keyLength, {
      N: parameters.N,
      r: parameters.r,
      p: parameters.p,
      maxmem: 64 * 1024 * 1024,
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey as Buffer);
    });
  });
}

export function checklistInvitationPasswordValid(password: unknown): password is string {
  return PASSWORD_PATTERN.test(String(password ?? ""));
}

export async function hashChecklistInvitationPassword(password: string) {
  if (!checklistInvitationPasswordValid(password)) {
    throw new Error("A senha deve conter somente 4 a 8 números.");
  }
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt);
  return {
    hash: hash.toString("base64url"),
    salt: salt.toString("base64url"),
    parameters: SCRYPT_PARAMETERS,
  };
}

export async function verifyChecklistInvitationPassword(args: {
  password: string;
  hash: string;
  salt: string;
  parameters: unknown;
}) {
  if (!checklistInvitationPasswordValid(args.password)) return false;
  const raw = args.parameters as Partial<typeof SCRYPT_PARAMETERS> | null;
  if (
    raw?.version !== 1 || raw.N !== SCRYPT_PARAMETERS.N || raw.r !== SCRYPT_PARAMETERS.r ||
    raw.p !== SCRYPT_PARAMETERS.p || raw.keyLength !== SCRYPT_PARAMETERS.keyLength
  ) return false;
  try {
    const expected = Buffer.from(args.hash, "base64url");
    const actual = await scrypt(args.password, Buffer.from(args.salt, "base64url"), SCRYPT_PARAMETERS);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function createChecklistInvitationToken(args: {
  invitationPublicId: string;
  documentPublicId: string;
  expiresAt: string;
}) {
  const payload: InvitationTokenPayload = {
    v: 1,
    i: args.invitationPublicId,
    d: args.documentPublicId,
    e: Math.floor(new Date(args.expiresAt).getTime() / 1_000),
  };
  return signPayload("checklist-invitation-token-v1", payload);
}

export function verifyChecklistInvitationToken(token: string): InvitationTokenPayload | null {
  const payload = verifyPayload<InvitationTokenPayload>("checklist-invitation-token-v1", token);
  if (
    payload?.v !== 1 || !UUID_PATTERN.test(payload.i) || !UUID_PATTERN.test(payload.d) ||
    !Number.isSafeInteger(payload.e) || payload.e <= 0
  ) return null;
  return payload;
}

export function createChecklistSigningSession(args: {
  invitationPublicId: string;
  documentPublicId: string;
  cpfHmac: string;
  durationSeconds?: number;
}) {
  const payload: ChecklistSigningSession = {
    v: 1,
    i: args.invitationPublicId,
    d: args.documentPublicId,
    c: args.cpfHmac,
    e: Math.floor(Date.now() / 1_000) + (args.durationSeconds ?? 60 * 60),
  };
  return signPayload("checklist-signing-session-v1", payload);
}

export function verifyChecklistSigningSession(token: string): ChecklistSigningSession | null {
  const payload = verifyPayload<ChecklistSigningSession>("checklist-signing-session-v1", token);
  if (
    payload?.v !== 1 || !UUID_PATTERN.test(payload.i) || !UUID_PATTERN.test(payload.d) ||
    !/^[0-9a-f]{64}$/.test(payload.c) || !Number.isSafeInteger(payload.e) ||
    payload.e <= Math.floor(Date.now() / 1_000)
  ) return null;
  return payload;
}

export function checklistAssetKey(invitationPublicId: string, storagePath: string) {
  return hmac("checklist-signing-asset-v1", `${invitationPublicId}\0${storagePath}`);
}

export function checklistSigningPublicUrl(origin: string, token: string) {
  return `${origin.replace(/\/$/, "")}/assinar/checklist/${encodeURIComponent(token)}`;
}

export function checklistInvitationStatus(args: {
  consumedAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  expiresAt: string;
  hasNewerVersion: boolean;
  documentSigned: boolean;
  now?: number;
}): ChecklistConviteStatus {
  if (args.consumedAt) return "UTILIZADO";
  if (args.hasNewerVersion || args.revocationReason === "SUPERADO") return "SUPERADO";
  if (args.revokedAt) return "REVOGADO";
  if (new Date(args.expiresAt).getTime() <= (args.now ?? Date.now())) return "EXPIRADO";
  if (args.documentSigned) return "REVOGADO";
  return "ATIVO";
}

export function validateChecklistSigningOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  if (!origin) return process.env.NODE_ENV !== "production";
  const allowed = new Set<string>();
  allowed.add(new URL(request.url).origin);
  for (const candidate of [process.env.NEXT_PUBLIC_APP_URL, process.env.APP_URL, process.env.NEXTAUTH_URL]) {
    if (!candidate) continue;
    try { allowed.add(new URL(candidate).origin); } catch { /* configuração inválida não autoriza origem */ }
  }
  return allowed.has(origin);
}
