// app/api/config/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { requireConfigEdit } from "@/app/api/_authz/perms";
import { normalizarRegrasDestaque } from "@/lib/ordens/destaque";

// Evita cache no App Router
export const revalidate = 0;
export const dynamic = "force-dynamic";

const CONFIG_SELECT_BASE_LEGADO =
  "id, aviso_pagamento, checklist_obrigatorio, alerta_estoque_pdv, habilitar_emissao_nfe, emissao_nf_no_modulo_ordens, emissao_nf_no_modulo_vendas, emissao_nf_ordens_nao_pagas, emissao_nf_vendas_nao_pagas, modo_baixa_estoque_os, created_at, habilitar_drawers";

const CONFIG_SELECT_BASE_SEM_SETOR_PADRAO = `${CONFIG_SELECT_BASE_LEGADO}, produto_preco_medio_compra_obrigatorio, habilitar_edicao_transacoes, permitir_produto_avulso_os`;
const CONFIG_SELECT_BASE_SEM_NCM_OBRIGATORIO = `${CONFIG_SELECT_BASE_SEM_SETOR_PADRAO}, setor_padrao_os_id`;
const CONFIG_SELECT_BASE = `${CONFIG_SELECT_BASE_SEM_NCM_OBRIGATORIO}, produto_ncm_obrigatorio`;

const CONFIG_SELECT_BASE_SEM_MODO_BAIXA =
  "id, aviso_pagamento, checklist_obrigatorio, alerta_estoque_pdv, habilitar_emissao_nfe, emissao_nf_no_modulo_ordens, emissao_nf_no_modulo_vendas, emissao_nf_ordens_nao_pagas, emissao_nf_vendas_nao_pagas, created_at, habilitar_drawers";

const CONFIG_SELECT_AGENDAMENTO =
  "agendamento_intervalo_minutos, agendamento_hora_inicio, agendamento_hora_fim, agendamento_dias_trabalho";

const CONFIG_SELECT_IMPRESSAO_SEM_COR_TEXTO =
  "impressao_cor_primaria, impressao_cor_secundaria";

const CONFIG_SELECT_IMPRESSAO = `${CONFIG_SELECT_IMPRESSAO_SEM_COR_TEXTO}, impressao_cor_texto`;

const CONFIG_SELECT_SEM_IMPRESSAO = `${CONFIG_SELECT_BASE}, ${CONFIG_SELECT_AGENDAMENTO}`;
const CONFIG_SELECT_SEM_COR_TEXTO = `${CONFIG_SELECT_BASE}, ${CONFIG_SELECT_AGENDAMENTO}, ${CONFIG_SELECT_IMPRESSAO_SEM_COR_TEXTO}`;
const CONFIG_SELECT_COMPLETO_SEM_NCM_OBRIGATORIO = `${CONFIG_SELECT_BASE_SEM_NCM_OBRIGATORIO}, ${CONFIG_SELECT_AGENDAMENTO}, ${CONFIG_SELECT_IMPRESSAO}`;
const CONFIG_SELECT_COMPLETO_SEM_SETOR_PADRAO = `${CONFIG_SELECT_BASE_SEM_SETOR_PADRAO}, ${CONFIG_SELECT_AGENDAMENTO}, ${CONFIG_SELECT_IMPRESSAO}`;
const CONFIG_SELECT_COMPLETO_LEGADO = `${CONFIG_SELECT_BASE_LEGADO}, ${CONFIG_SELECT_AGENDAMENTO}, ${CONFIG_SELECT_IMPRESSAO}`;
const CONFIG_SELECT_SEM_MODO_BAIXA = `${CONFIG_SELECT_BASE_SEM_MODO_BAIXA}, ${CONFIG_SELECT_AGENDAMENTO}, ${CONFIG_SELECT_IMPRESSAO}`;
const CONFIG_SELECT_SEM_DESTAQUE_STATUS = `${CONFIG_SELECT_BASE}, ${CONFIG_SELECT_AGENDAMENTO}, ${CONFIG_SELECT_IMPRESSAO}`;
const CONFIG_SELECT_SEM_FATURAMENTO = `${CONFIG_SELECT_SEM_DESTAQUE_STATUS}, destaque_os_por_status`;
const CONFIG_SELECT_COMPLETO = `${CONFIG_SELECT_SEM_FATURAMENTO}, habilitar_faturamento_os`;

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
    habilitar_faturamento_os: config.habilitar_faturamento_os === true,
    agendamento_intervalo_minutos: Number(config.agendamento_intervalo_minutos ?? 60),
    agendamento_hora_inicio: String(config.agendamento_hora_inicio ?? "08:00").slice(0, 5),
    agendamento_hora_fim: String(config.agendamento_hora_fim ?? "18:00").slice(0, 5),
    agendamento_dias_trabalho: Array.isArray(config.agendamento_dias_trabalho)
      ? config.agendamento_dias_trabalho
      : [1, 2, 3, 4, 5],
    impressao_cor_primaria: corHexValida(config.impressao_cor_primaria) ?? "#2563eb",
    impressao_cor_secundaria: corHexValida(config.impressao_cor_secundaria) ?? "#0891b2",
    impressao_cor_texto: corHexValida(config.impressao_cor_texto) ?? "#ffffff",
    modo_baixa_estoque_os: modoBaixaEstoqueOSValido(config.modo_baixa_estoque_os) ?? "ORCAMENTO",
    produto_preco_medio_compra_obrigatorio: config.produto_preco_medio_compra_obrigatorio === true,
    produto_ncm_obrigatorio: config.produto_ncm_obrigatorio === true,
    habilitar_edicao_transacoes: config.habilitar_edicao_transacoes === true,
    permitir_produto_avulso_os: config.permitir_produto_avulso_os === true,
    setor_padrao_os_id: Number.isInteger(Number(config.setor_padrao_os_id))
      && Number(config.setor_padrao_os_id) > 0
      ? Number(config.setor_padrao_os_id)
      : null,
    destaque_os_por_status: normalizarRegrasDestaque(config.destaque_os_por_status),
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

  const semFaturamento = await supabase.from("config_geral")
    .select(CONFIG_SELECT_SEM_FATURAMENTO).order("id", { ascending: false }).limit(1).maybeSingle();
  if (!semFaturamento.error) return comPadroesAgendamento(semFaturamento.data);
  if (!colunaNaoExiste(semFaturamento.error)) throw semFaturamento.error;

  const semDestaqueStatus = await supabase
    .from("config_geral")
    .select(CONFIG_SELECT_SEM_DESTAQUE_STATUS)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!semDestaqueStatus.error) return comPadroesAgendamento(semDestaqueStatus.data);
  if (!colunaNaoExiste(semDestaqueStatus.error)) throw semDestaqueStatus.error;

  const semCorTexto = await supabase
    .from("config_geral")
    .select(CONFIG_SELECT_SEM_COR_TEXTO)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!semCorTexto.error) return comPadroesAgendamento(semCorTexto.data);
  if (!colunaNaoExiste(semCorTexto.error)) throw semCorTexto.error;

  const semNcmObrigatorio = await supabase
    .from("config_geral")
    .select(CONFIG_SELECT_COMPLETO_SEM_NCM_OBRIGATORIO)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!semNcmObrigatorio.error) return comPadroesAgendamento(semNcmObrigatorio.data);
  if (!colunaNaoExiste(semNcmObrigatorio.error)) throw semNcmObrigatorio.error;

  const semSetorPadrao = await supabase
    .from("config_geral")
    .select(CONFIG_SELECT_COMPLETO_SEM_SETOR_PADRAO)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!semSetorPadrao.error) return comPadroesAgendamento(semSetorPadrao.data);
  if (!colunaNaoExiste(semSetorPadrao.error)) throw semSetorPadrao.error;

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

  const semFaturamento = await supabase.from("config_geral")
    .select(CONFIG_SELECT_SEM_FATURAMENTO).order("id", { ascending: false }).limit(1).maybeSingle();
  if (!semFaturamento.error) return comPadroesAgendamento(semFaturamento.data);
  if (!colunaNaoExiste(semFaturamento.error)) throw semFaturamento.error;

  const semDestaqueStatus = await supabase
    .from("config_geral")
    .select(CONFIG_SELECT_SEM_DESTAQUE_STATUS)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!semDestaqueStatus.error) return comPadroesAgendamento(semDestaqueStatus.data);
  if (!colunaNaoExiste(semDestaqueStatus.error)) throw semDestaqueStatus.error;

  const semCorTexto = await supabase
    .from("config_geral")
    .select(CONFIG_SELECT_SEM_COR_TEXTO)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!semCorTexto.error) return comPadroesAgendamento(semCorTexto.data);
  if (!colunaNaoExiste(semCorTexto.error)) throw semCorTexto.error;

  const semNcmObrigatorio = await supabase
    .from("config_geral")
    .select(CONFIG_SELECT_COMPLETO_SEM_NCM_OBRIGATORIO)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!semNcmObrigatorio.error) return comPadroesAgendamento(semNcmObrigatorio.data);
  if (!colunaNaoExiste(semNcmObrigatorio.error)) throw semNcmObrigatorio.error;

  const semSetorPadrao = await supabase
    .from("config_geral")
    .select(CONFIG_SELECT_COMPLETO_SEM_SETOR_PADRAO)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!semSetorPadrao.error) return comPadroesAgendamento(semSetorPadrao.data);
  if (!colunaNaoExiste(semSetorPadrao.error)) throw semSetorPadrao.error;

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
      "produto_ncm_obrigatorio",
      "habilitar_edicao_transacoes",
      "permitir_produto_avulso_os",
      "habilitar_faturamento_os",
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

    if (body.impressao_cor_texto !== undefined) {
      const val = corHexValida(body.impressao_cor_texto);
      if (val === undefined) return respostaJSON({ error: "Cor do texto de impressao invalida." }, 400);
      patch.impressao_cor_texto = val;
    }

    if (body.modo_baixa_estoque_os !== undefined) {
      const val = modoBaixaEstoqueOSValido(body.modo_baixa_estoque_os);
      if (val === undefined) {
        return respostaJSON({ error: "Modo de baixa de estoque da OS invalido." }, 400);
      }
      patch.modo_baixa_estoque_os = val;
    }

    if (body.setor_padrao_os_id !== undefined) {
      if (body.setor_padrao_os_id === null || body.setor_padrao_os_id === "") {
        patch.setor_padrao_os_id = null;
      } else {
        const setorId = Number(body.setor_padrao_os_id);
        if (!Number.isInteger(setorId) || setorId <= 0) {
          return respostaJSON({ error: "Setor padr\u00e3o da OS inv\u00e1lido." }, 400);
        }

        const { data: setor, error: setorError } = await supabase
          .from("setor")
          .select("id")
          .eq("id", setorId)
          .eq("ativo", true)
          .maybeSingle();

        if (setorError) throw setorError;
        if (!setor) {
          return respostaJSON({ error: "O setor padr\u00e3o selecionado n\u00e3o existe ou est\u00e1 inativo." }, 400);
        }
        patch.setor_padrao_os_id = setorId;
      }
    }

    if (body.destaque_os_por_status !== undefined) {
      const bruto = body.destaque_os_por_status;
      if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
        return respostaJSON({ error: "Destaques por status devem vir como um objeto." }, 400);
      }

      // A normalizacao descarta status desconhecido e cor fora da paleta. Na
      // leitura isso e bom (config velha nao derruba a lista), mas no PUT nao:
      // salvar em silencio menos regras do que o usuario cadastrou e pior do
      // que recusar e dizer o motivo.
      const regras = normalizarRegrasDestaque(bruto);
      if (Object.keys(regras).length !== Object.keys(bruto).length) {
        return respostaJSON(
          { error: "Há destaque por status com status ou cor inválidos." },
          400,
        );
      }
      patch.destaque_os_por_status = regras;
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
