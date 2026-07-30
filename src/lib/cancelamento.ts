/** Tamanho maximo aceito para o motivo, alinhado ao campo do formulario. */
export const MOTIVO_CANCELAMENTO_MAX = 500;

/**
 * Le e normaliza o motivo do cancelamento do corpo da requisicao.
 * Retorna `null` quando ausente/vazio — o chamador responde 400.
 */
export async function lerMotivoCancelamento(req: Request) {
  const body = await req.json().catch(() => ({}));
  const motivo = String(body?.motivo ?? body?.motivoCancelamento ?? "").trim();
  if (!motivo) return null;
  return motivo.slice(0, MOTIVO_CANCELAMENTO_MAX);
}
