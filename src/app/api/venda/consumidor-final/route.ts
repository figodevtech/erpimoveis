export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { idDoConsumidorFinal } from "@/lib/clientes/consumidor-final-server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const CAMPOS = `
  id, tipopessoa, cpfcnpj, nomerazaosocial, email, telefone, endereco,
  cidade, estado, bairro, cep, inscricaoestadual, inscricaomunicipal, codigomunicipio,
  ind_ie_dest, createdat, updatedat, endereconumero, enderecocomplemento, status, codigo_sistema
`;

/**
 * O Consumidor Final, no formato do seletor de cliente, para o PDV usar na
 * venda sem cliente identificado. A permissão é a de vendas (middleware).
 */
export async function GET() {
  try {
    const id = await idDoConsumidorFinal();
    const { data, error } = await supabaseAdmin.from("cliente").select(CAMPOS).eq("id", id).single();
    if (error) throw error;
    return NextResponse.json({ data: { ...data, veiculos: [], ordens: [] } });
  } catch (error) {
    console.error("Erro ao carregar o Consumidor Final", error);
    // Erro do PostgREST não é `Error`, mas traz a mensagem do banco (ex.: nome já usado).
    const mensagem = (error as { message?: string } | null)?.message ?? "";
    return NextResponse.json({ error: mensagem || "Não foi possível carregar o Consumidor Final." }, { status: 500 });
  }
}
