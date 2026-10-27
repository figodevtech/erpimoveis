import "server-only";

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

import { MENSAGEM_CLIENTE_DO_SISTEMA } from "./consumidor-final";

/** Id do Consumidor Final; o banco cria o cadastro se ainda faltar. */
export async function idDoConsumidorFinal(): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("cliente_consumidor_final_id");
  if (error) throw error;
  const id = Number(data);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Consumidor Final não encontrado.");
  return id;
}

/**
 * Resposta 409 quando o cliente é do sistema; `null` quando pode seguir.
 * O banco recusaria do mesmo jeito — aqui a recusa sai com mensagem clara.
 */
export async function recusaSeClienteDoSistema(clienteId: number): Promise<NextResponse | null> {
  const { data, error } = await supabaseAdmin
    .from("cliente")
    .select("codigo_sistema")
    .eq("id", clienteId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.codigo_sistema) return null;
  return NextResponse.json({ error: MENSAGEM_CLIENTE_DO_SISTEMA }, { status: 409 });
}
