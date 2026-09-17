import { MercadoLivreApiError } from "@/lib/integrations/mercadolivre";

// O Envios Flex não é campo do anúncio: tem recurso próprio, que responde 204 sem
// corpo. Por isso as chamadas daqui não usam os utilitários que sempre leem JSON.
const ML_API_BASE_URL = "https://api.mercadolibre.com";

export type MercadoLivreItemFlex = {
  /** O anúncio está sendo oferecido com Envios Flex. */
  active: boolean;
  /** O Mercado Livre aceita ativar o Envios Flex neste anúncio. */
  available: boolean;
};

/**
 * Situação do Envios Flex pelas tags de envio do anúncio: `self_service_in`
 * quando está ativo, `self_service_available` ou `self_service_out` quando o
 * anúncio pode entrar. Sem nenhuma delas, o Flex não se aplica ao anúncio.
 */
export function resolveMercadoLivreItemFlex(shippingTags: unknown): MercadoLivreItemFlex {
  const tags = (Array.isArray(shippingTags) ? shippingTags : []).map((tag) => String(tag ?? "").toLowerCase());
  const active = tags.includes("self_service_in");
  return {
    active,
    available: active || tags.includes("self_service_available") || tags.includes("self_service_out"),
  };
}

/** `GET /flex/sites/{site}/items/{item}/v2` — fonte oficial da situação do anúncio. */
export async function getMercadoLivreItemFlex(accessToken: string, siteId: string, itemId: string) {
  const response = await flexRequest("GET", accessToken, siteId, itemId);
  const text = await response.text();
  if (!response.ok) throw new MercadoLivreApiError(flexPath(siteId, itemId), response.status, text);

  try {
    return Boolean(JSON.parse(text)?.has_flex);
  } catch {
    return false;
  }
}

/** Ativa (`POST`) ou desativa (`DELETE`) o Envios Flex do anúncio; ambos respondem 204. */
export async function setMercadoLivreItemFlex(accessToken: string, siteId: string, itemId: string, enabled: boolean) {
  const response = await flexRequest(enabled ? "POST" : "DELETE", accessToken, siteId, itemId);
  if (response.ok) return;

  const text = await response.text();
  throw new MercadoLivreApiError(flexPath(siteId, itemId), response.status, text);
}

/** Recusas documentadas do recurso de Flex, em texto que o usuário entende. */
export function mercadoLivreFlexErrorMessage(error: unknown, enabled: boolean) {
  const status = error instanceof MercadoLivreApiError ? error.status : null;
  const message = String((error as { message?: unknown })?.message ?? "");

  if (status === 400 && /already in flex/i.test(message)) return "Este anúncio já está no Envios Flex.";
  if (status === 400) return "O Mercado Livre recusou a alteração do Envios Flex neste anúncio.";
  if (status === 403) {
    return "Este anúncio não oferece Envios Flex. Confira se ele está com Mercado Envios e se a categoria aceita a modalidade.";
  }
  if (status === 404) return "O Mercado Livre não encontrou este anúncio no Envios Flex.";
  if (status === 409) return "O Mercado Livre ainda está processando outra alteração deste anúncio. Tente novamente em instantes.";
  return enabled ? "Falha ao ativar o Envios Flex." : "Falha ao desativar o Envios Flex.";
}

function flexPath(siteId: string, itemId: string) {
  return `/flex/sites/${encodeURIComponent(siteId)}/items/${encodeURIComponent(itemId)}/v2`;
}

function flexRequest(method: string, accessToken: string, siteId: string, itemId: string) {
  return fetch(`${ML_API_BASE_URL}${flexPath(siteId, itemId)}`, {
    method,
    signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store",
  });
}
