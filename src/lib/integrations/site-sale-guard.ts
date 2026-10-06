import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function isSiteSale(vendaId: number) {
  const { data, error } = await supabaseAdmin.from("site_order_link")
    .select("id").eq("venda_id", vendaId).limit(1).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
