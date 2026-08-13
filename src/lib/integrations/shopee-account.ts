import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type ShopeeAccount = {
  id: number;
  empresa_id: number;
  shop_id: number;
  shop_name: string | null;
  region: string;
  expires_at: string | null;
};

export async function getShopeeAccount(empresaId: number, accountId?: number) {
  let query = supabaseAdmin
    .from("shopee_account")
    .select("id, empresa_id, shop_id, shop_name, region, expires_at")
    .eq("empresa_id", empresaId);
  if (accountId) query = query.eq("id", accountId);
  const { data, error } = await query.order("updated_at", { ascending: false }).limit(1).single();
  if (error) throw error;
  return data as ShopeeAccount;
}
