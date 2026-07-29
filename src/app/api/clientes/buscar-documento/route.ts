import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";


export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const raw = (searchParams.get("doc") || "").trim();
    if (!raw) {
      return NextResponse.json({ error: "Parâmetro 'doc' é obrigatório." }, { status: 400 });
    }

    // normaliza: remove tudo que não é digito/letra
    const doc = raw.replace(/[^\dA-Za-z]/g, "");

    // cliente por cpfcnpj
    const { data: clientes, error: errCli } = await supabase
      .from("cliente")
      .select("id, nomerazaosocial, email, telefone, cpfcnpj")
      .eq("cpfcnpj", doc)
      .limit(1);

    if (errCli) throw errCli;

    const cliente = clientes?.[0] ?? null;

    if (!cliente) {
      return NextResponse.json({ cliente: null, veiculos: [] });
    }

    const { data: veiculos, error: errVei } = await supabase
      .from("veiculo")
      .select("id, placa, modelo, marca, ano, cor, kmatual")
      .eq("clienteid", cliente.id)
      .order("modelo", { ascending: true });

    if (errVei) throw errVei;

    return NextResponse.json({ cliente, veiculos: veiculos ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    console.error("GET /api/clientes/by-document", err);
    return NextResponse.json({ error: "Falha ao buscar cliente" }, { status: 500 });
  }
}
