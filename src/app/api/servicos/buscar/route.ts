// src/app/api/servicos/buscar/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0; // sem cache

function removeAccents(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const page = Math.max(Number(searchParams.get("page") ?? 1), 1);
    const rawQ = (searchParams.get("search") ?? searchParams.get("q") ?? "").trim();
    const codigoParam = (searchParams.get("codigo") || "").trim();

    const limit = Math.min(Number(searchParams.get("limit") ?? 50) || 50, 200);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from("servico")
      .select(
        "id,codigo,descricao,precohora,codigoservicomunicipal,aliquotaiss,cnae,itemlistaservico,tiposervicoid,permite_agendamento,gera_comissao,ativo",
        { count: "exact" }
      )
      .eq("ativo", true)
      .order("descricao", { ascending: true })
      .range(from, to);

    let isExactIdOnly = false;
    let isExactCodeOnly = false;
    let cleanQ = rawQ;

    if (/^#\s*\d+$/.test(rawQ)) {
      isExactIdOnly = true;
      cleanQ = rawQ.replace(/^#\s*/, "");
    } else if (/^id:\s*\d+$/i.test(rawQ)) {
      isExactIdOnly = true;
      cleanQ = rawQ.replace(/^id:\s*/i, "");
    } else if (/^id=\s*\d+$/i.test(rawQ)) {
      isExactIdOnly = true;
      cleanQ = rawQ.replace(/^id=\s*/i, "");
    } else if (/^code:\s*\S+/i.test(rawQ)) {
      isExactCodeOnly = true;
      cleanQ = rawQ.replace(/^code:\s*/i, "");
    } else if (/^codigo:\s*\S+/i.test(rawQ)) {
      isExactCodeOnly = true;
      cleanQ = rawQ.replace(/^codigo:\s*/i, "");
    }

    if (codigoParam && !cleanQ) {
      isExactCodeOnly = true;
      cleanQ = codigoParam;
    }

    if (cleanQ) {
      if (isExactIdOnly) {
        query = query.eq("id", Number(cleanQ));
      } else if (isExactCodeOnly) {
        query = query.ilike("codigo", `%${cleanQ}%`);
      } else {
        const isNumeric = /^\d+$/.test(cleanQ);
        const unaccented = removeAccents(cleanQ);
        const hasDiffAccents = unaccented !== cleanQ.toLowerCase();

        if (isNumeric) {
          query = query.or(
            `id.eq.${cleanQ},codigo.ilike.%${cleanQ}%,descricao.ilike.%${cleanQ}%,codigoservicomunicipal.ilike.%${cleanQ}%,cnae.ilike.%${cleanQ}%,itemlistaservico.ilike.%${cleanQ}%`
          );
        } else if (hasDiffAccents) {
          query = query.or(
            `codigo.ilike.%${cleanQ}%,descricao.ilike.%${cleanQ}%,codigoservicomunicipal.ilike.%${cleanQ}%,cnae.ilike.%${cleanQ}%,itemlistaservico.ilike.%${cleanQ}%,codigo.ilike.%${unaccented}%,descricao.ilike.%${unaccented}%,codigoservicomunicipal.ilike.%${unaccented}%`
          );
        } else {
          query = query.or(
            `codigo.ilike.%${cleanQ}%,descricao.ilike.%${cleanQ}%,codigoservicomunicipal.ilike.%${cleanQ}%,cnae.ilike.%${cleanQ}%,itemlistaservico.ilike.%${cleanQ}%`
          );
        }
      }
    }

    const { data, error, count } = await query;

    if (error) throw error;

    let items = data ?? [];

    // Reordenar por relevância: se for busca numérica, põe ID exato no topo
    if (cleanQ && /^\d+$/.test(cleanQ)) {
      const targetId = Number(cleanQ);
      const exactIndex = items.findIndex((item) => Number(item.id) === targetId);
      if (exactIndex > 0) {
        const [exactItem] = items.splice(exactIndex, 1);
        items.unshift(exactItem);
      }
    }

    // Se a busca bater com código exato, joga no topo
    if (cleanQ && !isExactIdOnly) {
      const targetCode = cleanQ.toLowerCase();
      const exactCodeIndex = items.findIndex(
        (item) => String(item.codigo ?? "").toLowerCase() === targetCode
      );
      if (exactCodeIndex > 0) {
        const [exactItem] = items.splice(exactCodeIndex, 1);
        items.unshift(exactItem);
      }
    }

    const servicos = items.map((s: any) => ({
      id: Number(s.id),
      codigo: String(s.codigo ?? ""),
      descricao: String(s.descricao ?? ""),
      precohora: Number(s.precohora ?? 0),
      codigoservicomunicipal: s.codigoservicomunicipal ? String(s.codigoservicomunicipal) : null,
      aliquotaiss: s.aliquotaiss != null ? Number(s.aliquotaiss) : null,
      cnae: s.cnae ? String(s.cnae) : null,
      itemlistaservico: s.itemlistaservico ? String(s.itemlistaservico) : null,
      tiposervicoid: s.tiposervicoid ? Number(s.tiposervicoid) : null,
      permite_agendamento: Boolean(s.permite_agendamento),
      gera_comissao: Boolean(s.gera_comissao ?? true),
      ativo: Boolean(s.ativo ?? true),
    }));

    const total = count ?? 0;
    const totalPages = total > 0 ? Math.ceil(total / limit) : 0;
    const pageCount = servicos.length;

    return NextResponse.json(
      {
        servicos,
        pagination: {
          total,
          page,
          limit,
          totalPages,
          pageCount,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    console.error("GET /api/servicos/buscar", err);
    return NextResponse.json(
      { error: "Falha ao buscar serviços" },
      { status: 500 }
    );
  }
}
