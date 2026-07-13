import { refreshMercadoLivreToken, tokenExpiresAt } from "@/lib/integrations/mercadolivre";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type MercadoLivreAccountCredentials = {
  id: number;
  empresa_id: number;
  ml_user_id: number;
  site_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
};

export async function getValidMercadoLivreAccount(empresaId: number) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_account")
    .select("id, empresa_id, ml_user_id, site_id, access_token, refresh_token, expires_at")
    .eq("empresa_id", empresaId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();
  if (error) throw error;

  const account = data as MercadoLivreAccountCredentials;
  const expiresAt = account.expires_at ? new Date(account.expires_at).getTime() : 0;
  const shouldRefresh = Boolean(account.refresh_token && (!expiresAt || expiresAt - Date.now() < 5 * 60 * 1000));
  if (!shouldRefresh) return account;

  const token = await refreshMercadoLivreToken(account.refresh_token as string);
  const updated = {
    ...account,
    access_token: token.access_token,
    refresh_token: token.refresh_token ?? account.refresh_token,
    expires_at: tokenExpiresAt(token.expires_in),
  };
  const { error: updateError } = await supabaseAdmin
    .from("mercadolivre_account")
    .update({
      access_token: updated.access_token,
      refresh_token: updated.refresh_token,
      token_type: token.token_type ?? null,
      scope: token.scope ?? null,
      expires_at: updated.expires_at,
      raw_token: token,
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id);
  if (updateError) throw updateError;

  return updated;
}
