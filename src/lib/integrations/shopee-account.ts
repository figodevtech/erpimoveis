import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { refreshShopeeToken, shopeeTokenExpiresAt } from "@/lib/integrations/shopee";

export type ShopeeAccount = {
  id: number;
  empresa_id: number;
  shop_id: number;
  shop_name: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: string | null;
};

export async function getValidShopeeAccount(empresaId: number, accountId?: number) {
  let query = supabaseAdmin
    .from("shopee_account")
    .select("id, empresa_id, shop_id, shop_name, access_token, refresh_token, expires_at")
    .eq("empresa_id", empresaId);
  if (accountId) query = query.eq("id", accountId);
  const { data, error } = await query.order("updated_at", { ascending: false }).limit(1).single();
  if (error) throw error;
  return ensureValidShopeeAccount(data as ShopeeAccount);
}

export async function ensureValidShopeeAccount(account: ShopeeAccount) {
  const expiresAt = account.expires_at ? new Date(account.expires_at).getTime() : 0;
  if (expiresAt && expiresAt - Date.now() >= 5 * 60_000) return account;
  if (!account.refresh_token) throw new Error("A autorização Shopee expirou. Reconecte a loja.");

  const token = await refreshShopeeToken(account.refresh_token, account.shop_id);
  const updated = {
    ...account,
    access_token: token.access_token,
    refresh_token: token.refresh_token || account.refresh_token,
    expires_at: shopeeTokenExpiresAt(token.expire_in),
  };
  const { error } = await supabaseAdmin
    .from("shopee_account")
    .update({
      access_token: updated.access_token,
      refresh_token: updated.refresh_token,
      expires_at: updated.expires_at,
      raw_token: token,
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id);
  if (error) throw error;
  return updated;
}
