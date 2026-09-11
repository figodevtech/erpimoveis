import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Registro do que foi enviado ao Mercado Livre ao validar e ao publicar.
 *
 * Uma recusa do calculador de envios (o clássico "user has not mode me1") só é
 * diagnosticável com o payload e a resposta de `shipping_modes` em mãos, e os
 * dois se perdem quando a requisição termina.
 */

export type MercadoLivreListingPayloadLogInput = {
  empresaId: number;
  produtoId?: number | null;
  mlUserId?: number | string | null;
  mlItemId?: string | null;
  operacao: "VALIDACAO" | "CRIACAO";
  status: "SUCESSO" | "AVISO" | "ERRO";
  categoryId?: string | null;
  listingTypeId?: string | null;
  shippingMode?: string | null;
  logisticType?: string | null;
  freeShipping?: boolean | null;
  httpStatus?: number | null;
  itemPayload: unknown;
  shippingModesRequest?: unknown;
  shippingModesResponse?: unknown;
  response?: unknown;
  warnings?: string[];
  error?: string | null;
};

/**
 * Nunca interrompe o fluxo do anúncio: falhar ao gravar diagnóstico não pode
 * derrubar uma publicação que o Mercado Livre aceitou.
 */
export async function logMercadoLivreListingPayload(input: MercadoLivreListingPayloadLogInput) {
  try {
    const { data, error } = await supabaseAdmin
      .from("mercadolivre_listing_payload_log")
      .insert({
        empresa_id: input.empresaId,
        produto_id: Number.isInteger(input.produtoId) && Number(input.produtoId) > 0 ? input.produtoId : null,
        ml_user_id: input.mlUserId != null && Number.isFinite(Number(input.mlUserId)) ? Number(input.mlUserId) : null,
        ml_item_id: input.mlItemId ?? null,
        operacao: input.operacao,
        status: input.status,
        category_id: input.categoryId ?? null,
        listing_type_id: input.listingTypeId ?? null,
        shipping_mode: input.shippingMode ?? null,
        logistic_type: input.logisticType ?? null,
        free_shipping: input.freeShipping ?? null,
        http_status: input.httpStatus ?? null,
        item_payload: sanitize(input.itemPayload) ?? {},
        shipping_modes_request: sanitize(input.shippingModesRequest) ?? null,
        shipping_modes_response: sanitize(input.shippingModesResponse) ?? null,
        response: sanitize(input.response) ?? null,
        warnings: input.warnings ?? [],
        error: input.error ?? null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("mercadolivre_listing_payload_log insert", error.message);
      return null;
    }

    console.info("mercado-livre listing payload registrado", {
      log_id: data?.id,
      empresa_id: input.empresaId,
      operacao: input.operacao,
      status: input.status,
      shipping_mode: input.shippingMode,
      logistic_type: input.logisticType,
    });
    return data?.id ?? null;
  } catch (error: any) {
    console.error("mercadolivre_listing_payload_log", error?.message ?? error);
    return null;
  }
}

const SENSITIVE_KEYS = /^(access_token|refresh_token|authorization|client_secret|client_id)$/i;

/** Remove qualquer credencial que tenha entrado num objeto por engano. */
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 12 || value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry, depth + 1));
  if (typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_KEYS.test(key))
      .map(([key, entry]) => [key, sanitize(entry, depth + 1)]),
  );
}
