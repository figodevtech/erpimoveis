import { createHmac, timingSafeEqual } from "node:crypto";

function deriveSecret(apiToken: string) {
  return createHmac("sha256", apiToken)
    .update("erpoficina:focus-webhook:v1")
    .digest("hex");
}

function configuredSecrets() {
  const explicit = process.env.FOCUS_WEBHOOK_SECRET?.trim();
  if (explicit) return [explicit];

  return [
    process.env.FOCUS_NFE_API_TOKEN,
    process.env.FOCUS_NFE_API_TOKEN_HOMOLOGACAO,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .map(deriveSecret);
}

export function getFocusWebhookSecret(environment?: string | null) {
  const explicit = process.env.FOCUS_WEBHOOK_SECRET?.trim();
  if (explicit) return explicit;

  const production = String(environment ?? "").toUpperCase() === "PRODUCAO";
  const apiToken = (
    production
      ? process.env.FOCUS_NFE_API_TOKEN
      : process.env.FOCUS_NFE_API_TOKEN_HOMOLOGACAO
  )?.trim();

  return apiToken ? deriveSecret(apiToken) : null;
}

export function isValidFocusWebhookSecret(received: string | null | undefined) {
  if (!received) return false;
  const receivedBuffer = Buffer.from(received);

  return configuredSecrets().some((expected) => {
    const expectedBuffer = Buffer.from(expected);
    return (
      receivedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(receivedBuffer, expectedBuffer)
    );
  });
}
