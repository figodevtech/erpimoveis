import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Toda escrita do ERP num anúncio faz o Mercado Livre devolver um webhook
 * (`items`, `items_prices`, `stock-locations`, `user-products-families`). Sem
 * registrar a autoria, o ERP processa esse webhook e avisa o usuário sobre uma
 * alteração que ele mesmo acabou de fazer.
 */
export const MERCADOLIVRE_OUTBOUND_TOUCH_KINDS = [
  "PRECO",
  "ESTOQUE",
  "ANUNCIO",
  "STATUS",
  "DESCRICAO",
  "FOTOS",
  "COMPATIBILIDADE",
  "PRECO_QUANTIDADE",
] as const;

export type MercadoLivreOutboundTouchKind = (typeof MERCADOLIVRE_OUTBOUND_TOUCH_KINDS)[number];

/**
 * O Mercado Livre entrega o webhook em segundos. Uma janela maior só aumenta a
 * chance de engolir uma alteração legítima feita por outra pessoa no painel logo
 * depois do ERP ter escrito.
 */
export const MERCADOLIVRE_ECHO_WINDOW_MINUTES = 10;

export type MercadoLivreOutboundTouch = {
  id: number;
  ml_item_id: string;
  kind: MercadoLivreOutboundTouchKind;
  origin: string | null;
  created_at: string;
};

/**
 * Nunca lança: um registro de auditoria não pode derrubar uma publicação de
 * anúncio que já foi aceita pelo Mercado Livre.
 */
export async function registerMercadoLivreOutboundTouch(params: {
  empresaId: number;
  itemId: string | null | undefined;
  kinds: MercadoLivreOutboundTouchKind | MercadoLivreOutboundTouchKind[];
  origin: string;
}) {
  const itemId = String(params.itemId ?? "").trim();
  const kinds = Array.from(new Set(Array.isArray(params.kinds) ? params.kinds : [params.kinds]));
  if (!itemId || !Number.isFinite(params.empresaId) || !kinds.length) return;

  const { error } = await supabaseAdmin.from("mercadolivre_outbound_touch").insert(
    kinds.map((kind) => ({
      empresa_id: params.empresaId,
      ml_item_id: itemId,
      kind,
      origin: params.origin.slice(0, 200),
    })),
  );
  if (error) console.warn("Não foi possível registrar a escrita do ERP no Mercado Livre:", error);
}

/**
 * Devolve o toque mais recente do ERP no anúncio dentro da janela, ou `null`
 * quando a alteração veio de fora.
 */
export async function findRecentMercadoLivreOutboundTouch(params: {
  itemId: string | null | undefined;
  kinds?: MercadoLivreOutboundTouchKind[];
  windowMinutes?: number;
}): Promise<MercadoLivreOutboundTouch | null> {
  const itemId = String(params.itemId ?? "").trim();
  if (!itemId) return null;

  const windowMinutes = params.windowMinutes ?? MERCADOLIVRE_ECHO_WINDOW_MINUTES;
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  let query = supabaseAdmin
    .from("mercadolivre_outbound_touch")
    .select("id, ml_item_id, kind, origin, created_at")
    .eq("ml_item_id", itemId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  if (params.kinds?.length) query = query.in("kind", params.kinds);

  const { data, error } = await query.maybeSingle();
  if (error) {
    // Falhar aqui significaria notificar de novo, não deixar de sincronizar.
    console.warn("Não foi possível consultar escritas recentes do ERP no Mercado Livre:", error);
    return null;
  }
  return (data as MercadoLivreOutboundTouch | null) ?? null;
}

export async function purgeMercadoLivreOutboundTouches(hours = 24) {
  const before = new Date(Date.now() - hours * 60 * 60_000).toISOString();
  const { error } = await supabaseAdmin.from("mercadolivre_outbound_touch").delete().lt("created_at", before);
  if (error) console.warn("Não foi possível limpar o histórico de escritas do Mercado Livre:", error);
}
