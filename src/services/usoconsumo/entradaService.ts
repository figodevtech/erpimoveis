import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { entradaUsoConsumoSchema, zodMessage } from "@/lib/usoconsumo/schemas";

type Overrides = { origem?: "AJUSTE_RAPIDO" | "MANUAL" | "NFE_TERCEIRO" | "INVENTARIO"; fiscal?: boolean };

export async function registrarEntradaUsoConsumo(body: unknown, userId: string | null, overrides: Overrides = {}) {
  const candidate = { ...(body as Record<string, unknown>), ...overrides };
  const parsed = entradaUsoConsumoSchema.safeParse(candidate);
  if (!parsed.success) throw Object.assign(new Error(zodMessage(parsed.error, candidate)), { statusCode: 400 });
  const { itens, transacoes, ...entrada } = parsed.data;

  // "Obriga informar valor" é regra do tipo cadastrado em tipos_entrada. Entradas
  // vindas de NF-e ficam de fora: o documento pode trazer item bonificado sem valor.
  if (entrada.origem !== "NFE_TERCEIRO") {
    const { data: tipoCadastrado } = await supabaseAdmin
      .from("tipos_entrada")
      .select("nome, exige_valor")
      .eq("codigo", entrada.tipo)
      .maybeSingle();
    if (tipoCadastrado?.exige_valor !== false && itens.some((item) => Number(item.valor_unitario_compra) <= 0)) {
      throw Object.assign(
        new Error(`O tipo "${tipoCadastrado?.nome ?? entrada.tipo}" exige valor unitário maior que zero.`),
        { statusCode: 400 },
      );
    }
  }

  const { data, error } = await supabaseAdmin.rpc("registrar_entrada_usoconsumo", {
    p_entrada: { ...entrada, chave_nfe: entrada.chave_nfe?.replace(/\D/g,""), created_by: userId },
    p_itens: itens,
    p_transacoes: transacoes,
  });
  if (error) throw error;
  return data as { entrada_id: number; valor_total: number };
}

