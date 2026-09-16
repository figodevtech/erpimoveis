import { ensureMercadoLivreToken } from "@/lib/integrations/mercadolivre-token";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type MercadoLivreAccountCredentials = {
  id: number;
  empresa_id: number;
  ml_user_id: number;
  site_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  default_listing_type_id: "free" | "gold_special" | "gold_pro";
};

export async function getValidMercadoLivreAccount(empresaId: number) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_account")
    .select("id, empresa_id, ml_user_id, site_id, access_token, refresh_token, expires_at, default_listing_type_id")
    .eq("empresa_id", empresaId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();
  if (error) throw error;

  const account = data as MercadoLivreAccountCredentials;
  const access_token = await ensureMercadoLivreToken(account);
  return { ...account, access_token };
}
