import { NextResponse } from "next/server";
import { requireUsoConsumoAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { usoConsumoError } from "@/lib/usoconsumo/api";

export async function GET() {
  try {
    await requireUsoConsumoAccess();
    const [fornecedores, bancos, categorias, planos, centros] = await Promise.all([
      supabaseAdmin.from("fornecedor").select("id,nomerazaosocial,nomefantasia,cpfcnpj").eq("ativo", true).order("nomerazaosocial").limit(500),
      supabaseAdmin.from("bancoconta").select("id,titulo").order("titulo").limit(500),
      supabaseAdmin.from("categoriatransacao").select("id,nome").eq("ativo", true).order("nome").limit(500),
      supabaseAdmin.from("planosdeconta").select("id,codigo,nome").eq("ativo", true).order("codigo").limit(500),
      supabaseAdmin.from("centrosdecusto").select("id,nome").eq("ativo", true).order("nome").limit(500),
    ]);
    const failure = [fornecedores,bancos,categorias,planos,centros].find((result) => result.error)?.error;
    if (failure) throw failure;
    return NextResponse.json({
      fornecedores: fornecedores.data ?? [], bancos: bancos.data ?? [], categorias: categorias.data ?? [],
      planos: planos.data ?? [], centros: centros.data ?? [],
    });
  } catch (error) { return usoConsumoError(error, "Erro ao carregar opções."); }
}

