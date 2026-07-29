// src/app/api/veiculos/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { requireVeiculosAccess, requireVeiculosCreate } from "@/app/api/_authz/perms";

function respostaJSON(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function normalizarPlaca(valor: string) {
  return valor.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function parseIntSeguro(valor: string | null) {
  if (!valor) return null;
  const n = Number(valor);
  return Number.isInteger(n) ? n : null;
}

const TIPOS_VEICULO = new Set(["CARROS", "MOTOS", "CAMINHOES"]);

function tipoVeiculoValido(valor: string | undefined) {
  return !!valor && TIPOS_VEICULO.has(valor);
}

/* ========================= GET (lista paginada) ========================= */

export async function GET(request: Request) {
  try {
    await requireVeiculosAccess();
    const { searchParams } = new URL(request.url);

    // filtros
    const clienteId = parseIntSeguro(searchParams.get("clienteId"));
    const placaRaw = (searchParams.get("placa") || "").trim();
    const tipo = (searchParams.get("tipo") || "").trim();
    const q = (searchParams.get("search") ?? searchParams.get("q") ?? "").trim();

    // paginação (igual ao /products)
    const page = Math.max(Number(searchParams.get("page") ?? 1), 1);
    const limitRaw =
      searchParams.get("limit") ?? searchParams.get("pageSize") ?? "50";
    const limit = Math.min(Math.max(Number(limitRaw), 1), 200);

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from("veiculo")
      .select(
        "id, clienteid, placa, placa_formatada, modelo, marca, ano, cor, kmatual, tipo, chassi, ano_modelo, versao, fipe, combustivel, transmissao, imgUrl, cliente:clienteid( id, nomerazaosocial, cpfcnpj, email, telefone )",
        { count: "exact" }
      )
      .order("id", { ascending: false })
      .range(from, to);

    if (clienteId !== null) query = query.eq("clienteid", clienteId);

    if (placaRaw) query = query.eq("placa", normalizarPlaca(placaRaw));
    if (tipo) query = query.eq("tipo", tipo);

    if (q) {
      query = query.or(`modelo.ilike.%${q}%,marca.ilike.%${q}%,placa.ilike.%${q}%,placa_formatada.ilike.%${q}%,chassi.ilike.%${q}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const items = data ?? [];
    const total = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const pageCount = items.length;
    const hasPrevPage = page > 1;
    const hasNextPage = page * limit < total;

    return respostaJSON({
      data: items,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        pageCount,
        hasPrevPage,
        hasNextPage,
      },
      filters: {
        search: q,
        clienteId,
        placa: placaRaw,
        tipo,
      },
    });
  } catch (err: any) {
    console.error("GET /api/veiculos", err);
    return respostaJSON({ error: err?.message || "Falha ao listar veículos" }, 500);
  }
}

/* ========================= POST (criar veículo) ========================= */

export async function POST(request: Request) {
  try {
    await requireVeiculosCreate();
    const body = await request.json().catch(() => null);
    if (!body) return respostaJSON({ error: "JSON inválido no body." }, 400);

    // Aceita: { veiculo }, { novoVeiculo } ou campos no topo
    const v = body?.veiculo ?? body?.novoVeiculo ?? body;

    // Aceita clienteId OU clienteid
    const clienteIdRaw = v?.clienteId ?? v?.clienteid;
    const clienteId =
      clienteIdRaw === null || clienteIdRaw === undefined || clienteIdRaw === ""
        ? null
        : Number(clienteIdRaw);

    const placa = typeof v?.placa === "string" ? normalizarPlaca(v.placa) : "";
    const chassi = v?.chassi === null || v?.chassi === undefined ? null : String(v.chassi).trim().toUpperCase();
    const modelo = typeof v?.modelo === "string" ? v.modelo.trim() : "";
    const marca = typeof v?.marca === "string" ? v.marca.trim() : "";

    const ano =
      v?.ano === null || v?.ano === undefined || v?.ano === "" ? null : Number(v.ano);

    const kmatual =
      v?.kmatual === null || v?.kmatual === undefined || v?.kmatual === ""
        ? null
        : Number(v.kmatual);

    const cor = v?.cor === null || v?.cor === undefined ? null : String(v.cor).trim();
    const tipo = v?.tipo ? String(v.tipo).trim() : undefined;

    const ano_modelo =
      v?.ano_modelo === null || v?.ano_modelo === undefined || v?.ano_modelo === "" ? null : Number(v.ano_modelo);
    const versao = v?.versao === null || v?.versao === undefined ? null : String(v.versao).trim();
    const fipe =
      v?.fipe === null || v?.fipe === undefined || v?.fipe === "" ? null : Number(v.fipe);
    const combustivel = v?.combustivel === null || v?.combustivel === undefined ? null : String(v.combustivel).trim();
    const transmissao = v?.transmissao === null || v?.transmissao === undefined ? null : String(v.transmissao).trim();

    if (clienteId !== null && (!Number.isInteger(clienteId) || clienteId <= 0)) {
      return respostaJSON(
        { error: "Campo 'clienteId' (ou 'clienteid') deve ser inteiro > 0 quando informado." },
        400
      );
    }
    if (!placa) return respostaJSON({ error: "Campo 'placa' é obrigatório." }, 400);
    if (!modelo) return respostaJSON({ error: "Campo 'modelo' é obrigatório." }, 400);
    if (!marca) return respostaJSON({ error: "Campo 'marca' é obrigatório." }, 400);
    if (!tipoVeiculoValido(tipo)) {
      return respostaJSON({ error: "Campo 'tipo' é obrigatório." }, 400);
    }

    if (ano !== null && (!Number.isInteger(ano) || ano < 1900 || ano > 3000)) {
      return respostaJSON({ error: "Campo 'ano' inválido." }, 400);
    }
    if (kmatual !== null && (!Number.isInteger(kmatual) || kmatual < 0)) {
      return respostaJSON({ error: "Campo 'kmatual' inválido." }, 400);
    }

    const payload: any = {
      clienteid: clienteId,
      placa,
      chassi,
      modelo,
      marca,
      ano,
      cor,
      kmatual,
      ano_modelo,
      versao,
      fipe,
      combustivel,
      transmissao,
      tipo,
    };

    const { data, error } = await supabase
      .from("veiculo")
      .insert(payload)
      .select("id, clienteid, placa, placa_formatada, modelo, marca, ano, cor, kmatual, tipo, chassi, ano_modelo, versao, fipe, combustivel, transmissao, imgUrl")
      .single();

    if (error) throw error;

    // no mesmo “formato” do /products (opcional, mas costuma ajudar no front)
    return respostaJSON({ data, id: data.id }, 201);
  } catch (err: any) {
    console.error("POST /api/veiculos", err);
    return respostaJSON({ error: err?.message || "Falha ao criar veículo" }, 500);
  }
}
