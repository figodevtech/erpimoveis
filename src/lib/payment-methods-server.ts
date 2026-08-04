import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function getPaymentMethodValues(): Promise<string[]> {
  const { data, error } = await supabaseAdmin.rpc("listar_metodos_pagamento");
  if (error) throw error;

  return (Array.isArray(data) ? data : [])
    .map((item) => String((item as { value?: unknown }).value ?? "").trim().toUpperCase())
    .filter(Boolean);
}
