// app/api/config/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireConfigEdit } from "@/app/api/_authz/perms";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// Evita cache no App Router
export const revalidate = 0;
export const dynamic = "force-dynamic";

const CONFIG_SELECT_BASE_LEGADO =
  "id, aviso_pagamento, checklist_obrigatorio, alerta_estoque_pdv, habilitar_emissao_nfe, emissao_nf_no_modulo_ordens, emissao_nf_no_modulo_vendas, emissao_nf_ordens_nao_pagas, emissao_nf_vendas_nao_pagas, modo_baixa_estoque_os, created_at, habilitar_drawers";

const CONFIG_SELECT_BASE = `${CONFIG_SELECT_BASE_LEGADO}, produto_preco_medio_compra_obrigatorio, habilitar_edicao_transacoes`;

const CONFIG_SELECT_BASE_SEM_MODO_BAIXA =
  "id, aviso_pagamento, checklist_obrigatorio, alerta_estoque_pdv, habilitar_emissao_nfe, emissao_nf_no_modulo_ordens, emissao_nf_no_modulo_vendas, emissao_nf_ordens_nao_pagas, emissao_nf_vendas_nao_pagas, created_at, habilitar_drawers";

const CONFIG_SELECT_AGENDAMENTO =
  "agendamento_intervalo_minutos, agendamento_hora_inicio, agendamento_hora_fim, agendamento_dias_trabalho";

const CONFIG_SELECT_IMPRESSAO =
  "impressao_cor_primaria, impressao_cor_secundaria";

const CONFIG_SELECT_SEM_IMPRESSAO = `${CONFIG_SELECT_BASE}, ${CONFIG_SELECT_AGENDAMENTO}`;
const CONFIG_SELECT_COMPLETO_LEGADO = `${CONFIG_SELECT_BASE_LEGADO}, ${CONFIG_SELECT_AGENDAMENTO}, ${CONFIG_SELECT_IMPRESSAO}`;
const CONFIG_SELECT_SEM_MODO_BAIXA = `${CONFIG_SELECT_BASE_SEM_MODO_BAIXA}, ${CONFIG_SELECT_AGENDAMENTO}, ${CONFIG_SELECT_IMPRESSAO}`;
const CONFIG_SELECT_COMPLETO = `${CONFIG_SELECT_BASE}, ${CONFIG_SELECT_AGENDAMENTO}, ${CONFIG_SELECT_IMPRESSAO}`;

function colunaNaoExiste(error: any) {
  return error?.code === "42703";
}

function respostaJSON(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function booleanValido(v: any) {
  return typeof v === "boolean" ? v : undefined;
}

function numeroValido(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function horaValida(v: any) {
  const s = String(v ?? "").trim();
  return /^\d{2}:\d{2}(:\d{2})?$/.test(s) ? s.slice(0, 5) : undefined;
}

function diasValidos(v: any) {
  if (!Array.isArray(v)) return undefined;
  const dias = [...new Set(v.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0 && item <= 6))];
  return dias.length > 0 ? dias.sort((a, b) => a - b) : undefined;
}

function corHexValida(v: any) {
  const s = String(v ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : undefined;
}

function modoBaixaEstoqueOSValido(v: any) {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "ORCAMENTO" || s === "EXECUCAO" ? s : undefined;
}

function comPadroesAgendamento(config: any) {
  if (!config) return null;

  return {
    ...config,
    agendamento_intervalo_minutos: Number(config.agendamento_intervalo_minutos ?? 60),
    agendamento_hora_inicio: String(config.agendamento_hora_inicio ?? "08:00").slice(0, 5),
    agendamento_hora_fim: String(config.agendamento_hora_fim ?? "18:00").slice(0, 5),
    agendamento_dias_trabalho: Array.isArray(config.agendamento_dias_trabalho)
      ? config.agendamento_dias_trabalho
      : [1, 2, 3, 4, 5],
    impressao_cor_primaria: corHexValida(config.impressao_cor_primaria) ?? "#2563eb",
    impressao_cor_secundaria: corHexValida(config.impressao_cor_secundaria) ?? "#0891b2",
    modo_baixa_estoque_os: modoBaixaEstoqueOSValido(config.modo_baixa_estoque_os) ?? "ORCAMENTO",
    produto_preco_medio_compra_obrigatorio: config.produto_preco_medio_compra_obrigatorio === true,
    habilitar_edicao_transacoes: config.habilitar_edicao_transacoes === true,
  };
}

// Busca sempre a config mais recente (normalmente só existe 1 linha)
async function buscarConfigAtual() {
  const { data, error } = await supabase
    .from("config_geral")
    .select(CONFIG_SELECT_COMPLETO)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!error) return comPadroesAgendamento(data);
  if (!colunaNaoExiste(error)) throw error;

  const semPrecoMedioObrigatorio = await supabase
    .from("config_geral")
    .select(CONFIG_SELECT_COMPLETO_LEGADO)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!semPrecoMedioObrigatorio.error) return comPadroesAgendamento(semPrecoMedioObrigatorio.data);
  if (!colunaNaoExiste(semPrecoMedioObrigatorio.error)) throw semPrecoMedioObrigatorio.error;

  const semModoBaixa = await supabase
    .from("config_geral")
    .select(CONFIG_SELECT_SEM_MODO_BAIXA)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!semModoBaixa.error) return comPadroesAgendamento(semModoBaixa.data);
  if (!colunaNaoExiste(semModoBaixa.error)) throw semModoBaixa.error;

  const semImpressao = await supabase
    .from("config_geral")
    .select(CONFIG_SELECT_SEM_IMPRESSAO)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!semImpressao.error) return comPadroesAgendamento(semImpressao.data);
  if (!colunaNaoExiste(semImpressao.error)) throw semImpressao.error;

  const fallback = await supabase
    .from("config_geral")
    .select(CONFIG_SELECT_BASE_SEM_MODO_BAIXA)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fallback.error) throw fallback.error;
  return comPadroesAgendamento(fallback.data);
}

async function criarConfigPadraoSeNaoExistir() {
  const atual = await buscarConfigAtual();
  if (atual) return atual;

  const { data, error } = await supabase
    .from("config_geral")
    .insert({}) // usa defaults do banco
    .select(CONFIG_SELECT_COMPLETO)
    .single();

  if (!error) return comPadroesAgendamento(data);
  if (!colunaNaoExiste(error)) throw error;

  const semPrecoMedioObrigatorio = await supabase
    .from("config_geral")
    .select(CONFIG_SELECT_COMPLETO_LEGADO)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!semPrecoMedioObrigatorio.error) return comPadroesAgendamento(semPrecoMedioObrigatorio.data);
  if (!colunaNaoExiste(semPrecoMedioObrigatorio.error)) throw semPrecoMedioObrigatorio.error;

  const semModoBaixa = await supabase
    .from("config_geral")
    .select(CONFIG_SELECT_SEM_MODO_BAIXA)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!semModoBaixa.error) return comPadroesAgendamento(semModoBaixa.data);
  if (!colunaNaoExiste(semModoBaixa.error)) throw semModoBaixa.error;

  const semImpressao = await supabase
    .from("config_geral")
    .select(CONFIG_SELECT_SEM_IMPRESSAO)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!semImpressao.error) return comPadroesAgendamento(semImpressao.data);
  if (!colunaNaoExiste(semImpressao.error)) throw semImpressao.error;

  const fallback = await supabase
    .from("config_geral")
    .select(CONFIG_SELECT_BASE_SEM_MODO_BAIXA)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fallback.error) throw fallback.error;
  return comPadroesAgendamento(fallback.data);
}

export async function GET() {
  try {
    const config = await criarConfigPadraoSeNaoExistir();
    return respostaJSON({ config });
  } catch (err: any) {
    console.error("GET /api/config-geral", err);
    return respostaJSON({ error: "Falha ao buscar configuração geral." }, 500);
  }
}

export async function PUT(request: Request) {
  try {
    await requireConfigEdit();
    const body = await request.json().catch(() => null);
    if (!body) return respostaJSON({ error: "JSON inválido no body." }, 400);

    const validKeys = [
      "checklist_obrigatorio",
      "alerta_estoque_pdv",
      "habilitar_emissao_nfe",
      "emissao_nf_no_modulo_ordens",
      "emissao_nf_no_modulo_vendas",
      "emissao_nf_ordens_nao_pagas",
      "emissao_nf_vendas_nao_pagas",
      "produto_preco_medio_compra_obrigatorio",
      "habilitar_edicao_transacoes",
    ];

    const patch: any = {};

    for (const key of validKeys) {
      if (body[key] !== undefined) {
        const val = booleanValido(body[key]);
        if (val === undefined) {
          return respostaJSON({ error: `Campo '${key}' deve ser boolean.` }, 400);
        }
        patch[key] = val;
      }
    }

    if (body.agendamento_intervalo_minutos !== undefined) {
      const val = numeroValido(body.agendamento_intervalo_minutos);
      if (val === undefined || ![15, 30, 45, 60, 90, 120, 180, 240].includes(val)) {
        return respostaJSON({ error: "Intervalo de agendamento invalido." }, 400);
      }
      patch.agendamento_intervalo_minutos = val;
    }

    if (body.agendamento_hora_inicio !== undefined) {
      const val = horaValida(body.agendamento_hora_inicio);
      if (val === undefined) return respostaJSON({ error: "Horario inicial invalido." }, 400);
      patch.agendamento_hora_inicio = val;
    }

    if (body.agendamento_hora_fim !== undefined) {
      const val = horaValida(body.agendamento_hora_fim);
      if (val === undefined) return respostaJSON({ error: "Horario final invalido." }, 400);
      patch.agendamento_hora_fim = val;
    }

    if (body.agendamento_dias_trabalho !== undefined) {
      const val = diasValidos(body.agendamento_dias_trabalho);
      if (val === undefined) return respostaJSON({ error: "Selecione ao menos um dia de trabalho." }, 400);
      patch.agendamento_dias_trabalho = val;
    }

    if (body.impressao_cor_primaria !== undefined) {
      const val = corHexValida(body.impressao_cor_primaria);
      if (val === undefined) return respostaJSON({ error: "Cor primaria de impressao invalida." }, 400);
      patch.impressao_cor_primaria = val;
    }

    if (body.impressao_cor_secundaria !== undefined) {
      const val = corHexValida(body.impressao_cor_secundaria);
      if (val === undefined) return respostaJSON({ error: "Cor secundaria de impressao invalida." }, 400);
      patch.impressao_cor_secundaria = val;
    }

    if (body.modo_baixa_estoque_os !== undefined) {
      const val = modoBaixaEstoqueOSValido(body.modo_baixa_estoque_os);
      if (val === undefined) {
        return respostaJSON({ error: "Modo de baixa de estoque da OS invalido." }, 400);
      }
      patch.modo_baixa_estoque_os = val;
    }

    if (Object.keys(patch).length === 0) {
      return respostaJSON({ error: "Nenhum campo válido para atualizar." }, 400);
    }

    const atual = await criarConfigPadraoSeNaoExistir();

    const { data, error } = await supabase
      .from("config_geral")
      .update(patch)
      .eq("id", atual.id)
      .select("*")
      .single();

    if (error) {
      console.error("Supabase update error:", error);
      if (colunaNaoExiste(error)) {
        return respostaJSON(
          { error: "As configurações mais recentes ainda não foram aplicadas no banco. Rode as migrations do Supabase." },
          409
        );
      }
      return respostaJSON({ error: "Falha ao atualizar configuração geral." }, 500);
    }

    return respostaJSON({ config: comPadroesAgendamento(data) });
  } catch (err: any) {
    console.error("PUT /api/config-geral", err);
    return respostaJSON({ error: "Falha ao atualizar configuração geral." }, 500);
  }
}
