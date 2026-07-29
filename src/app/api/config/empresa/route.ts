import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";

export const revalidate = 0;
export const dynamic = "force-dynamic";

function normalizarRegimeTributario(valor: unknown): "1" | "2" | "3" | "4" {
  const regime = String(valor || "1").trim();

  if (regime === "1" || regime === "2" || regime === "3" || regime === "4") {
    return regime;
  }

  throw new Error("Regime tributário (CRT) deve ser 1, 2, 3 ou 4.");
}

// GET: retorna a primeira empresa cadastrada
export async function GET() {
  try {
    const { data, error } = await supabase
      .from("empresa")
      .select(
        `
        id,
        cnpj,
        razaosocial,
        nomefantasia,
        inscricaoestadual,
        inscricaoestadualst,
        inscricaomunicipal,
        endereco,
        numero,
        complemento,
        bairro,
        cep,
        uf,
        codigomunicipio,
        codigopais,
        nomepais,
        telefone,
        cnae,
        regimetributario,
        ambiente,
        certificadocaminho,
        certificadosenha,
        cschomologacao,
        cscproducao,
        placa_consulta_limite_mensal,
        placa_consulta_qtd_mes,
        placa_consulta_mes
      `
      )
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      // ainda não configurado
      return NextResponse.json({ empresa: null }, { headers: { "Cache-Control": "no-store" } });
    }

    const empresa = {
      empresaId: data.id,
      cnpj: data.cnpj || "",
      razaosocial: data.razaosocial || "",
      nomefantasia: data.nomefantasia || "",
      inscricaoestadual: data.inscricaoestadual || "",
      inscricaoestadualst: data.inscricaoestadualst || "",
      inscricaomunicipal: data.inscricaomunicipal || "",
      endereco: data.endereco || "",
      numero: data.numero || "",
      complemento: data.complemento || "",
      bairro: data.bairro || "",
      cep: data.cep || "",
      uf: data.uf || "",
      codigomunicipio: data.codigomunicipio || "",
      codigopais: data.codigopais || "1058",
      nomepais: data.nomepais || "BRASIL",
      telefone: data.telefone || "",
      cnae: data.cnae || "",
      regimetributario: (data.regimetributario || "1") as "1" | "2" | "3" | "4",
      ambiente: (data.ambiente || "HOMOLOGACAO") as "HOMOLOGACAO" | "PRODUCAO",
      certificadocaminho: data.certificadocaminho || "",
      certificadosenha: data.certificadosenha || "",
      cschomologacao: data.cschomologacao || "",
      cscproducao: data.cscproducao || "",
      placa_consulta_limite_mensal: data.placa_consulta_limite_mensal ?? 100,
      placa_consulta_qtd_mes: data.placa_consulta_qtd_mes ?? 0,
      placa_consulta_mes: data.placa_consulta_mes || "",
    };

    return NextResponse.json({ empresa }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    console.error("GET /api/config/empresa", e);
    return NextResponse.json({ error: "Falha ao carregar empresa" }, { status: 500 });
  }
}

// PUT: salva/upserta (por CNPJ). Se quiser forçar 1 registro só, pode fixar id=1.
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const v = body?.empresa || {};

    // normalizações simples de dígitos
    const onlyDigits = (s: string) => (s || "").replace(/\D+/g, "");

    const payload = {
      cnpj: onlyDigits(v.cnpj || ""),
      razaosocial: String(v.razaosocial || ""),
      nomefantasia: v.nomefantasia ? String(v.nomefantasia) : null,
      inscricaoestadual: v.inscricaoestadual ? onlyDigits(v.inscricaoestadual) : null,
      inscricaoestadualst: v.inscricaoestadualst ? onlyDigits(v.inscricaoestadualst) : null,
      inscricaomunicipal: v.inscricaomunicipal ? onlyDigits(v.inscricaomunicipal) : null,
      endereco: String(v.endereco || ""),
      numero: v.numero ? String(v.numero) : null,
      complemento: v.complemento ? String(v.complemento) : null,
      bairro: v.bairro ? String(v.bairro) : null,
      cep: v.cep ? onlyDigits(v.cep) : null,
      uf: v.uf ? String(v.uf) : null,
      codigomunicipio: onlyDigits(v.codigomunicipio || ""),
      codigopais: v.codigopais ? onlyDigits(v.codigopais) : "1058",
      nomepais: v.nomepais ? String(v.nomepais) : "BRASIL",
      telefone: v.telefone ? onlyDigits(v.telefone) : null,
      cnae: v.cnae ? String(v.cnae) : null,
      regimetributario: normalizarRegimeTributario(v.regimetributario),
      ambiente: String(v.ambiente || "HOMOLOGACAO"),
      certificadocaminho: v.certificadocaminho ? String(v.certificadocaminho) : null,
      certificadosenha: v.certificadosenha ? String(v.certificadosenha) : null,
      cschomologacao: v.cschomologacao ? String(v.cschomologacao) : null,
      cscproducao: v.cscproducao ? String(v.cscproducao) : null,
      updatedat: new Date().toISOString(),
    };

    // upsert por cnpj (unique)
    const { data, error } = await supabase
      .from("empresa")
      .upsert(payload, { onConflict: "cnpj" })
      .select("id")
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({ ok: true, id: data?.id ?? null });
  } catch (e: any) {
    console.error("PUT /api/config/empresa", e);
    return NextResponse.json({ error: e?.message || "Falha ao salvar empresa" }, { status: 500 });
  }
}
