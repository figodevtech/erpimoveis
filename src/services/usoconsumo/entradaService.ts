import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { entradaUsoConsumoSchema, zodMessage } from "@/lib/usoconsumo/schemas";

type Overrides = { origem?: "AJUSTE_RAPIDO" | "MANUAL" | "NFE_TERCEIRO" | "INVENTARIO"; fiscal?: boolean };

export async function registrarEntradaUsoConsumo(body: unknown, userId: string | null, overrides: Overrides = {}) {
  const candidate = { ...(body as Record<string, unknown>), ...overrides };
  const parsed = entradaUsoConsumoSchema.safeParse(candidate);
  if (!parsed.success) throw Object.assign(new Error(zodMessage(parsed.error)), { statusCode: 400 });
  const { itens, transacoes, ...entrada } = parsed.data;
  const { data, error } = await supabaseAdmin.rpc("registrar_entrada_usoconsumo", {
    p_entrada: { ...entrada, chave_nfe: entrada.chave_nfe?.replace(/\D/g,""), created_by: userId },
    p_itens: itens,
    p_transacoes: transacoes,
  });
  if (error) throw error;
  return data as { entrada_id: number; valor_total: number };
}

