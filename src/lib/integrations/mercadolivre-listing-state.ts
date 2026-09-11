import {
  isMercadoLivreNotFound,
  mercadoLivreApiGet,
  mercadoLivreTokenMetadata,
  refreshMercadoLivreToken,
  tokenExpiresAt,
} from "@/lib/integrations/mercadolivre";
import { describeMercadoLivreListingStatus } from "@/lib/integrations/mercadolivre-listing-status";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Reconciliação do estado dos anúncios vinculados — inclusive o fim deles.
 *
 * O ERP só descobria uma exclusão feita no Mercado Livre se alguém clicasse em
 * "Conferir situação", e mesmo assim não adiantava: quem carrega a exclusão é o
 * `sub_status`, que não tem coluna, e o `status` de um anúncio excluído é
 * `closed` — igual ao de um finalizado normal. Sem diferença no `status`, a
 * conferência comparava, achava igual e não gravava nada. O vínculo ficava para
 * sempre, e como existe `unique (empresa_id, produto_id)` o produto seguia
 * ocupado por um anúncio que não existe mais, sem poder ser reanunciado.
 *
 * Aqui a exclusão vira ação: confirmada pelo Mercado Livre, o vínculo é apagado.
 * Isso leva junto, por `on delete cascade`, o histórico diário de métricas e a
 * fila de estoque daquele anúncio — decisão tomada com o cliente, porque ver o
 * produto livre para reanunciar vale mais que o passado de um anúncio que não
 * volta. Sobra rastro em `mercadolivre_listing_edit_log` e na auditoria de
 * preço, que guardam `ml_item_id` e soltam a referência com `on delete set null`.
 *
 * A regra de ouro é nunca apagar por dúvida: só remove com resposta do Mercado
 * Livre dizendo `sub_status: deleted` ou 404 no anúncio. Falha de rede, 5xx e
 * token vencido não apagam nada — ficam registrados e tentam de novo na hora
 * seguinte.
 */

/** O multiget do Mercado Livre aceita no máximo 20 ids por chamada. */
const BATCH_SIZE = 20;

type LinkRow = {
  id: number;
  empresa_id: number;
  produto_id: number | null;
  ml_item_id: string;
  status: string | null;
  item_tags: unknown;
};

type ItemState = { id?: string; status?: string; sub_status?: unknown; tags?: unknown };
type MultiGetEntry = { code?: number; body?: ItemState | null };

export type ListingStateEntry = {
  itemId: string;
  produtoId: number | null;
  /** `removed`: o vínculo saiu. `changed`: o anúncio mudou de situação. */
  action: "removed" | "changed" | "unchanged" | "failed";
  from: string | null;
  to: string | null;
  label: string | null;
  detail: string | null;
  /** Por que o vínculo foi removido, quando foi. */
  reason?: string;
  error?: string;
};

export async function refreshMercadoLivreListingStates(params?: { empresaId?: number }) {
  const links = await loadLinks(params?.empresaId);
  if (!links.length) return [] as ListingStateEntry[];

  const empresaIds = Array.from(new Set(links.map((link) => Number(link.empresa_id))));
  const tokenByEmpresa = await loadTokens(empresaIds);

  const results: ListingStateEntry[] = [];
  for (const empresaId of empresaIds) {
    const empresaLinks = links.filter((link) => Number(link.empresa_id) === empresaId);
    const accessToken = tokenByEmpresa.get(empresaId);
    if (!accessToken) {
      results.push(...empresaLinks.map((link) => failed(link, "Conta Mercado Livre não autorizada.")));
      continue;
    }

    for (let index = 0; index < empresaLinks.length; index += BATCH_SIZE) {
      const batch = empresaLinks.slice(index, index + BATCH_SIZE);
      results.push(...(await reconcileBatch(accessToken, batch)));
    }
  }

  const removed = results.filter((entry) => entry.action === "removed");
  if (removed.length) {
    console.info("mercado-livre vínculos removidos", {
      total: removed.length,
      itens: removed.map((entry) => `${entry.itemId}: ${entry.reason}`),
    });
  }

  return results;
}

/**
 * O multiget não garante devolver uma entrada por id pedido: anúncio excluído há
 * bastante tempo simplesmente some da resposta, e a entrada de erro vem sem
 * `body.id`, então não dá para casar por posição sem arriscar apagar o vínculo
 * errado. Por isso o lote resolve o que veio com `code: 200` e deixa o resto
 * para uma consulta individual, que responde sem ambiguidade.
 */
async function reconcileBatch(accessToken: string, batch: LinkRow[]) {
  const ids = batch.map((link) => String(link.ml_item_id)).join(",");
  const response = await mercadoLivreApiGet<MultiGetEntry[]>(
    accessToken,
    `/items?ids=${encodeURIComponent(ids)}&attributes=id,status,sub_status,tags`,
  ).catch((error: unknown) => error);

  if (!Array.isArray(response)) {
    const message = response instanceof Error ? response.message : "Falha ao consultar os anúncios.";
    return batch.map((link) => failed(link, message));
  }

  const bodyByItem = new Map<string, ItemState>();
  for (const entry of response) {
    if (entry?.code !== 200 || !entry.body?.id) continue;
    bodyByItem.set(String(entry.body.id).toUpperCase(), entry.body);
  }

  const results: ListingStateEntry[] = [];
  for (const link of batch) {
    const body = bodyByItem.get(String(link.ml_item_id).toUpperCase());
    results.push(body ? await applyState(link, body) : await probeMissingItem(accessToken, link));
  }
  return results;
}

/** Pergunta pelo anúncio isolado para separar "excluído" de "falhou a consulta". */
async function probeMissingItem(accessToken: string, link: LinkRow) {
  try {
    const item = await mercadoLivreApiGet<ItemState>(
      accessToken,
      `/items/${encodeURIComponent(String(link.ml_item_id))}?attributes=id,status,sub_status,tags`,
    );
    return await applyState(link, item ?? {});
  } catch (error: unknown) {
    if (isMercadoLivreNotFound(error)) {
      return await removeLink(link, "O anúncio não existe mais no Mercado Livre.");
    }
    return failed(link, error instanceof Error ? error.message : "Falha ao consultar o anúncio.");
  }
}

async function applyState(link: LinkRow, body: ItemState): Promise<ListingStateEntry> {
  const state = describeMercadoLivreListingStatus({
    status: body.status,
    subStatus: body.sub_status,
    tags: body.tags,
  });

  if (state.deleted) return await removeLink(link, "Anúncio excluído no Mercado Livre.");

  const tags = Array.isArray(body.tags) ? body.tags.map((tag) => String(tag)) : [];
  const previousStatus = String(link.status ?? "").toLowerCase();
  const previousTags = Array.isArray(link.item_tags) ? link.item_tags.map((tag) => String(tag)) : [];
  const statusChanged = Boolean(state.status) && state.status !== previousStatus;
  const tagsChanged = tags.join("|") !== previousTags.join("|");
  if (!statusChanged && !tagsChanged) {
    return unchanged(link, state.status || previousStatus || null, state.label, state.detail);
  }

  const { error } = await supabaseAdmin
    .from("mercadolivre_product_link")
    .update({
      status: state.status || link.status,
      item_tags: tags,
      updated_at: new Date().toISOString(),
    })
    .eq("id", link.id);
  if (error) return failed(link, error.message);

  // Sub_status novo sem troca de `status` não muda o rótulo do anúncio: grava,
  // mas não avisa como mudança de situação, para o aviso não virar ruído.
  if (!statusChanged) return unchanged(link, state.status || previousStatus || null, state.label, state.detail);

  return {
    itemId: String(link.ml_item_id),
    produtoId: link.produto_id ?? null,
    action: "changed",
    from: link.status ?? null,
    to: state.status,
    label: state.label,
    detail: state.detail,
  };
}

async function removeLink(link: LinkRow, reason: string): Promise<ListingStateEntry> {
  const { error } = await supabaseAdmin.from("mercadolivre_product_link").delete().eq("id", link.id);
  if (error) return failed(link, error.message);

  return {
    itemId: String(link.ml_item_id),
    produtoId: link.produto_id ?? null,
    action: "removed",
    from: link.status ?? null,
    to: null,
    label: "Excluído",
    detail: reason,
    reason,
  };
}

function unchanged(
  link: LinkRow,
  status: string | null,
  label: string | null,
  detail: string | null,
): ListingStateEntry {
  return {
    itemId: String(link.ml_item_id),
    produtoId: link.produto_id ?? null,
    action: "unchanged",
    from: link.status ?? null,
    to: status,
    label,
    detail,
  };
}

function failed(link: LinkRow, error: string): ListingStateEntry {
  return {
    itemId: String(link.ml_item_id),
    produtoId: link.produto_id ?? null,
    action: "failed",
    from: link.status ?? null,
    to: null,
    label: null,
    detail: null,
    error,
  };
}

/**
 * Lê todos os vínculos paginando.
 *
 * Sem paginar, o teto de linhas do PostgREST cortaria a lista em silêncio e os
 * anúncios do fim nunca seriam conferidos — a varredura pareceria completa e
 * deixaria vínculo excluído para trás.
 */
const PAGE_SIZE = 500;

async function loadLinks(empresaId?: number) {
  const links: LinkRow[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabaseAdmin
      .from("mercadolivre_product_link")
      .select("id, empresa_id, produto_id, ml_item_id, status, item_tags")
      .not("ml_item_id", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (Number.isFinite(empresaId) && Number(empresaId) > 0) query = query.eq("empresa_id", Number(empresaId));

    const { data, error } = await query;
    if (error) throw error;

    const page = (data ?? []) as LinkRow[];
    links.push(...page.filter((link) => link.ml_item_id && Number(link.empresa_id) > 0));
    if (page.length < PAGE_SIZE) break;
  }

  return links;
}

async function loadTokens(empresaIds: number[]) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_account")
    .select("id, empresa_id, access_token, refresh_token, expires_at")
    .in("empresa_id", empresaIds);
  if (error) throw error;

  const tokenByEmpresa = new Map<number, string>();
  for (const account of data ?? []) {
    const token = await ensureValidAccessToken(account).catch(() => "");
    if (token) tokenByEmpresa.set(Number(account.empresa_id), token);
  }
  return tokenByEmpresa;
}

async function ensureValidAccessToken(account: any) {
  const expiresAt = account.expires_at ? new Date(account.expires_at).getTime() : 0;
  if (!account.refresh_token || !expiresAt || expiresAt - Date.now() >= 5 * 60 * 1000) {
    return String(account.access_token ?? "");
  }

  const token = await refreshMercadoLivreToken(String(account.refresh_token));
  const { error } = await supabaseAdmin
    .from("mercadolivre_account")
    .update({
      access_token: token.access_token,
      refresh_token: token.refresh_token ?? account.refresh_token,
      token_type: token.token_type ?? null,
      scope: token.scope ?? null,
      expires_at: tokenExpiresAt(token.expires_in),
      raw_token: mercadoLivreTokenMetadata(token),
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id);
  if (error) throw error;
  return token.access_token;
}
