import { productImageUrlsForListing } from "@/lib/integrations/mercadolivre-listing-pictures";

/**
 * Busca a galeria do produto para o stepper do anúncio. Quem abre o stepper pelo
 * cadastro de estoque tem só a capa (`imgUrl`) em mãos; sem esta busca o anúncio
 * nascia com uma foto só.
 */
export async function loadProductImageUrls(produtoId: number, coverUrl?: string | null) {
  const response = await fetch(`/api/products/${produtoId}/images`, { cache: "no-store" });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error || "Falha ao carregar as imagens do produto.");
  const gallery = Array.isArray(json?.imagens) ? json.imagens.map((image: { url?: unknown }) => image?.url) : [];
  return productImageUrlsForListing(coverUrl, gallery);
}
