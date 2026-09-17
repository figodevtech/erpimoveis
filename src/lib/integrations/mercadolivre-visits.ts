import { mercadoLivreApiGet } from "@/lib/integrations/mercadolivre";

// Consultas simultâneas por empresa: a tela de Marketplace sincroniza os vínculos
// da página a cada carregamento, e uma chamada por anúncio em fila deixaria a
// tela lenta.
const CONCURRENCY = 5;

/**
 * Visitas totais de cada anúncio (`GET /visits/items?ids=`).
 *
 * A API aceita um único anúncio por chamada. Com mais de um, responde 400
 * "maximum amount of items to query is 1" para o lote inteiro — e foi assim que
 * nenhum total voltou a ser gravado depois que a empresa passou a ter o segundo
 * anúncio. A falha de um anúncio não impede os demais.
 */
export async function loadMercadoLivreItemVisits(accessToken: string, itemIds: string[]) {
  const visits = new Map<string, number>();
  const ids = Array.from(new Set(itemIds.map((id) => String(id ?? "").trim().toUpperCase()).filter(Boolean)));

  for (let index = 0; index < ids.length; index += CONCURRENCY) {
    await Promise.all(
      ids.slice(index, index + CONCURRENCY).map(async (itemId) => {
        try {
          const result = await mercadoLivreApiGet<Record<string, number>>(
            accessToken,
            `/visits/items?ids=${encodeURIComponent(itemId)}`,
          );
          const total = Number(Object.entries(result ?? {}).find(([id]) => id.toUpperCase() === itemId)?.[1]);
          if (Number.isFinite(total)) visits.set(itemId, total);
        } catch (error) {
          console.warn("Falha ao consultar visitas do anúncio Mercado Livre", { itemId, error });
        }
      }),
    );
  }

  return visits;
}
