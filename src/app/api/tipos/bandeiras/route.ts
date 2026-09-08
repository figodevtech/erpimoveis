export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

import {
  SELECT_BANDEIRA,
  SELECT_COM_FAIXAS,
  ensureAuth,
  mapBandeira,
  mensagemAmigavel,
  regravarFaixas,
  statusDoErro,
  validarFaixas,
} from "./_lib";

/**
 * Catalogo de bandeiras de cartao com a taxa por faixa de parcelamento.
 *
 * Serve dois consumidores bem diferentes:
 *   - Configuracoes > Tipos, que lista tudo para manter o cadastro;
 *   - o dialog de transacao, que carrega as ativas durante a abertura e filtra
 *     por conta e forma de pagamento localmente, sem novas buscas a cada troca.
 *
 * Os filtros opcionais `banco_id` e `metodopagamento` continuam disponíveis.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureAuth();

    const { searchParams } = new URL(req.url);
    const ativo = searchParams.get("ativo");
    const bancoId = searchParams.get("banco_id");
    const metodo = searchParams.get("metodopagamento");

    let query = supabaseAdmin
      .from("bandeira_cartao")
      .select(SELECT_COM_FAIXAS)
      .order("nome", { ascending: true });

    if (ativo === "true") query = query.eq("ativo", true);
    if (ativo === "false") query = query.eq("ativo", false);

    if (bancoId) {
      const id = Number(bancoId);
      if (!Number.isInteger(id) || id <= 0) {
        return NextResponse.json({ error: "Conta bancária inválida." }, { status: 400 });
      }
      query = query.eq("banco_id", id);
    }

    // Sem normalizar, "credito" nao casa com o enum e a lista volta vazia sem
    // dizer por que.
    if (metodo) query = query.eq("metodopagamento", metodo.trim().toUpperCase());

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ items: (data ?? []).map(mapBandeira) });
  } catch (error: any) {
    console.error("[/api/tipos/bandeiras GET] error:", error);
    const mensagem = String(error?.message ?? "");
    return NextResponse.json(
      { error: mensagemAmigavel(mensagem, "Erro ao carregar as bandeiras.") },
      { status: statusDoErro(mensagem) },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureAuth();

    const body = await req.json().catch(() => ({}));

    const nome = String(body.nome ?? "").trim();
    if (!nome) {
      return NextResponse.json({ error: "Nome da bandeira é obrigatório." }, { status: 400 });
    }

    const bancoId = Number(body.bancoId ?? body.banco_id);
    if (!Number.isInteger(bancoId) || bancoId <= 0) {
      return NextResponse.json({ error: "Selecione a conta bancária." }, { status: 400 });
    }

    const metodo = String(body.metodoPagamento ?? body.metodopagamento ?? "")
      .trim()
      .toUpperCase();
    if (!metodo) {
      return NextResponse.json({ error: "Selecione a forma de pagamento." }, { status: 400 });
    }

    const faixas = validarFaixas(body.parcelas);
    if (!faixas.ok) {
      return NextResponse.json({ error: faixas.erro }, { status: 400 });
    }

    const agora = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("bandeira_cartao")
      .insert({
        nome,
        descricao: String(body.descricao ?? "").trim() || null,
        banco_id: bancoId,
        metodopagamento: metodo,
        ativo: typeof body.ativo === "boolean" ? body.ativo : true,
        createdat: agora,
        updatedat: agora,
      })
      .select(SELECT_BANDEIRA)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Falha ao criar a bandeira." }, { status: 500 });
    }

    /*
     * A bandeira ja existe quando as faixas entram, e nao ha transacao cobrindo
     * as duas escritas — o supabase-js nao expoe uma. Se a segunda falhar, a
     * primeira e desfeita na mao; sobrar uma bandeira sem faixa nenhuma seria
     * pior, porque ela apareceria no seletor sem oferecer parcelamento nenhum.
     */
    try {
      await regravarFaixas(Number(data.id), faixas.faixas);
    } catch (erroDasFaixas) {
      await supabaseAdmin.from("bandeira_cartao").delete().eq("id", data.id);
      throw erroDasFaixas;
    }

    return NextResponse.json(
      { item: mapBandeira({ ...data, parcelas: faixas.faixas.map((f) => ({ parcelas: f.parcelas, taxa_percentual: f.taxaPercentual })) }) },
      { status: 201 },
    );
  } catch (error: any) {
    console.error("[/api/tipos/bandeiras POST] error:", error);
    const mensagem = String(error?.message ?? "");
    return NextResponse.json(
      { error: mensagemAmigavel(mensagem, "Erro ao cadastrar a bandeira.") },
      { status: statusDoErro(mensagem) },
    );
  }
}
