import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { analisarExclusaoEventoFinanceiro } from "@/lib/ordens/exclusao-evento-financeiro";
import { somarEventosDaOs } from "@/lib/ordens/eventos-financeiros";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import { mesesDeCompetenciaFechada } from "./competencia";
import { bloqueioDeStatusParaEventos } from "./status-os";

/**
 * A regra de negócio dos eventos financeiros de OS, sem guarda de permissão.
 *
 * Existe porque duas famílias de rota chegam aqui: `/api/ordens/{id}/eventos-
 * financeiros/...`, que pede `ordens:editar`, e `/api/eventos-financeiros/...`,
 * que pede `financeiro:editar` — a lista global de onde o financeiro lança o que
 * a recepção deixou pendente. A diferença entre as duas é só quem pode entrar;
 * o que acontece depois precisa ser a mesma coisa, e antes disto era o mesmo
 * código escrito duas vezes esperando divergir na primeira correção.
 *
 * Cada função devolve um `Resultado`, e não uma `NextResponse`, para o status e
 * o corpo continuarem sendo decisão de quem chama — a rota do financeiro devolve
 * exatamente o que a rota da OS devolve, e é `responder()` que fecha os dois.
 */
export type Resultado<T> =
  | { ok: true; corpo: T }
  | { ok: false; error: string; status: number; extra?: Record<string, unknown> };

const erro = (error: string, status: number, extra?: Record<string, unknown>) =>
  ({ ok: false as const, error, status, extra });

/** Fecha um `Resultado` na resposta HTTP. O erro leva junto o `extra` da regra. */
export function responder<T>(resultado: Resultado<T>, status = 200) {
  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.error, ...(resultado.extra ?? {}) },
      { status: resultado.status },
    );
  }
  return NextResponse.json(resultado.corpo, { status });
}

/** Converte a falha inesperada no mesmo formato das recusas de regra. */
export function responderFalha(error: any, mensagemPadrao: string) {
  return NextResponse.json(
    { error: error?.message || mensagemPadrao },
    { status: error?.statusCode || 500 },
  );
}

export function idValido(valor: unknown) {
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * A OS a que o evento pertence.
 *
 * As rotas do financeiro endereçam o evento direto, sem a OS na URL — mas toda
 * a regra abaixo é escrita em cima do par (OS, evento), porque é a OS que diz se
 * o lançamento ainda pode ser mexido. Este é o passo que traduz um endereço no
 * outro.
 */
export async function ordemDoEvento(eventId: number): Promise<Resultado<{ osId: number }>> {
  const { data, error } = await supabaseAdmin
    .from("eventos_financeiros")
    .select("id, ordemservicoid")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return erro("Evento financeiro não encontrado.", 404);
  const osId = idValido(data.ordemservicoid);
  if (!osId) return erro("Este evento financeiro não pertence a uma ordem de serviço.", 409);
  return { ok: true, corpo: { osId } };
}

async function carregarOs(osId: number) {
  const { data, error } = await supabaseAdmin
    .from("ordemservico")
    .select("id, status")
    .eq("id", osId)
    .eq("is_deleted", false)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Nomes de quem criou, para as linhas manuais dizerem de onde vieram. */
async function comCriadoPor(eventos: any[]) {
  const usuarioIds = Array.from(new Set(
    eventos
      .map((evento: any) => String(evento.created_by ?? "").trim())
      .filter(Boolean),
  ));
  if (usuarioIds.length === 0) return eventos.map((evento) => ({ ...evento, criado_por: null }));

  const { data, error } = await supabaseAdmin
    .from("usuario")
    .select("id, nome, email")
    .in("id", usuarioIds);
  if (error) throw error;

  const porId = new Map(
    (data ?? []).map((usuario: any) => [String(usuario.id), {
      id: String(usuario.id),
      nome: String(usuario.nome || usuario.email || "Usuário"),
    }]),
  );
  return eventos.map((evento: any) => ({
    ...evento,
    criado_por: evento.created_by
      ? porId.get(String(evento.created_by)) ?? { id: String(evento.created_by), nome: "Usuário não identificado" }
      : null,
  }));
}

export { comCriadoPor };

// ------------------------------------------------------------------ listar

export async function listarEventosDaOs(osId: number) {
  const { data, error } = await supabaseAdmin
    .from("eventos_financeiros")
    .select("*")
    .eq("ordemservicoid", osId)
    .order("data_evento", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;

  const eventos = await comCriadoPor(data ?? []);

  // A conta vem de `@/lib/ordens/eventos-financeiros`, a mesma que a relação
  // de ordens impressa usa. `liquido` fica com o nome antigo porque é o que a
  // tela já consome; na lib ele se chama `lucroReal`.
  const { lucroReal, ...totais } = somarEventosDaOs(eventos as any);

  return { ok: true as const, corpo: { eventos, totais: { ...totais, liquido: lucroReal } } };
}

// ------------------------------------------------------------------- criar

export async function criarEventoDaOs(
  osId: number,
  body: any,
  usuarioId: string | null,
): Promise<Resultado<{ evento: any }>> {
  const os = await carregarOs(osId);
  if (!os) return erro("OS não encontrada.", 404);

  const natureza = String(body?.natureza ?? "").toUpperCase();

  // OS concluída e sem cobrança seguem aceitando lançamento: despesa que
  // chega depois do fechamento é caso comum, e o evento nasce com a
  // competência da execução, recalculando a DRE daquele mês.
  const bloqueio = bloqueioDeStatusParaEventos(os.status, { natureza });
  if (bloqueio) return erro(bloqueio, 409);

  const descricao = String(body?.descricao ?? "").trim();
  const detalhe = String(body?.detalhe ?? "").trim() || null;
  const valor = Number(body?.valor);
  const eventoReceitaInformado = body?.eventoReceitaId != null;
  const eventoReceitaServicoLegadoInformado = body?.eventoReceitaServicoId != null;
  if (eventoReceitaInformado && eventoReceitaServicoLegadoInformado) {
    return erro("Informe somente um vínculo de receita para esta despesa.", 400);
  }
  const eventoReceitaVinculado = eventoReceitaInformado || eventoReceitaServicoLegadoInformado;
  const eventoReceitaId = Number(
    eventoReceitaInformado ? body?.eventoReceitaId : body?.eventoReceitaServicoId,
  );
  const tipoEvento = String(body?.tipo ?? "").toUpperCase();
  if (!["RECEITA", "DESPESA"].includes(natureza)) {
    return erro("Informe se o evento é uma receita ou despesa.", 400);
  }
  if (!descricao) return erro("A descrição é obrigatória.", 400);
  if (!Number.isFinite(valor) || valor <= 0) {
    return erro("O valor deve ser maior que zero.", 400);
  }
  if (eventoReceitaVinculado && (!Number.isInteger(eventoReceitaId) || eventoReceitaId <= 0)) {
    return erro("A receita informada é inválida.", 400);
  }
  // CONSUMO é o material gasto na OS sem repasse ao cliente. Aqui ele entra
  // sem passar pelo estoque — a fita comprada na hora para esta ordem. O
  // caminho com baixa é `/consumo-estoque`, que além do evento cria a saída.
  if (!eventoReceitaVinculado && !["PRODUTO", "SERVICO", "CONSUMO"].includes(tipoEvento)) {
    return erro("Informe se o lançamento é de Produto, Serviço ou Consumo.", 400);
  }
  // Só existe `CONSUMO:DESPESA` na DRE (linha 4.4, Materiais aplicados).
  // Uma receita de consumo não teria para onde ir e ficaria em pendência.
  if (tipoEvento === "CONSUMO" && natureza !== "DESPESA") {
    return erro("Um lançamento de consumo é sempre uma despesa.", 400);
  }

  if (eventoReceitaVinculado) {
    if (natureza !== "DESPESA") {
      return erro("Um evento vinculado a uma receita deve ser uma despesa.", 400);
    }

    const { data: receitaOrigem, error: receitaOrigemError } = await supabaseAdmin
      .from("eventos_financeiros")
      .select("id, origem, natureza, servicoid, descricao, valor, status")
      .eq("id", eventoReceitaId)
      .eq("ordemservicoid", osId)
      .maybeSingle();
    if (receitaOrigemError) throw receitaOrigemError;
    if (!receitaOrigem) return erro("A receita não foi encontrada nesta OS.", 404);
    if (receitaOrigem.natureza !== "RECEITA" || !["SERVICO", "FRETE"].includes(receitaOrigem.origem)) {
      return erro("Somente receitas de serviço ou frete podem receber uma despesa vinculada.", 400);
    }
    if (receitaOrigem.origem === "SERVICO" && !receitaOrigem.servicoid) {
      return erro("A receita de serviço não possui um serviço vinculado.", 409);
    }
    if (receitaOrigem.status !== "ATIVO") return erro("A receita informada não está ativa.", 409);

    const criadoEm = new Date().toISOString();
    const despesaDeFrete = receitaOrigem.origem === "FRETE";
    const { data, error } = await supabaseAdmin
      .from("eventos_financeiros")
      .insert({
        ordemservicoid: osId,
        source_type: "ORDEM_SERVICO",
        source_id: osId,
        source_item_id: despesaDeFrete ? receitaOrigem.id : receitaOrigem.servicoid,
        origem: receitaOrigem.origem,
        natureza: "DESPESA",
        natureza_dre: "CUSTO",
        chave_origem: `MANUAL:${randomUUID()}`,
        descricao,
        detalhe: detalhe || `Vinculada a ${receitaOrigem.descricao}`,
        valor: Math.round(valor * 100) / 100,
        servicoid: despesaDeFrete ? null : receitaOrigem.servicoid,
        is_manual: true,
        pode_gerar_transacao: true,
        dados_snapshot: {
          ...(despesaDeFrete
            ? {
                despesa_frete_manual: true,
                receita_frete_valor: Number(receitaOrigem.valor ?? 0),
                dre_linha_codigo: "4.6",
              }
            : {
                despesa_servico_manual: true,
                receita_servico_valor: Number(receitaOrigem.valor ?? 0),
              }),
          evento_receita_origem_id: receitaOrigem.id,
          criado_em: criadoEm,
        },
        created_by: usuarioId,
      })
      .select("*")
      .single();
    if (error) throw error;
    return { ok: true, corpo: { evento: data } };
  }

  const { data, error } = await supabaseAdmin
    .from("eventos_financeiros")
    .insert({
      ordemservicoid: osId,
      source_type: "ORDEM_SERVICO",
      source_id: osId,
      origem: tipoEvento,
      natureza,
      natureza_dre: natureza === "RECEITA" ? "RECEITA" : "CUSTO",
      chave_origem: `MANUAL:${randomUUID()}`,
      descricao,
      detalhe,
      valor: Math.round(valor * 100) / 100,
      is_manual: true,
      pode_gerar_transacao: true,
      dados_snapshot: {
        lancamento_avulso_manual: true,
        tipo_informado: tipoEvento,
        // Consumo lançado por aqui não tem saída de estoque atrás dele. A
        // marca separa os dois casos para quem lê o evento depois — o
        // estorno e o painel de impacto do cancelamento dependem disso.
        ...(tipoEvento === "CONSUMO" ? { consumo_de_estoque: false } : {}),
      },
      created_by: usuarioId,
    })
    .select("*")
    .single();
  if (error) throw error;
  return { ok: true, corpo: { evento: data } };
}

// ---------------------------------------------------------------- excluir

const EVENTO_EXCLUSAO_SELECT =
  "id, origem, natureza, status, descricao, valor, chave_origem, is_manual, transacaoid, lancamento_id, competencia_em, quantidade_snapshot, consumo_saida_id, consumo_usoconsumo_saida_id, dados_snapshot";

type ContextoExclusao = {
  impacto: ReturnType<typeof analisarExclusaoEventoFinanceiro>;
  mesesFechados: string[];
};

async function carregarImpactoExclusao(
  osId: number,
  eventId: number,
): Promise<Resultado<ContextoExclusao>> {
  const [{ data: os, error: osError }, { data: evento, error: eventoError }] = await Promise.all([
    supabaseAdmin
      .from("ordemservico")
      .select("id, status")
      .eq("id", osId)
      .eq("is_deleted", false)
      .maybeSingle(),
    supabaseAdmin
      .from("eventos_financeiros")
      .select(EVENTO_EXCLUSAO_SELECT)
      .eq("id", eventId)
      .eq("ordemservicoid", osId)
      .maybeSingle(),
  ]);
  if (osError) throw osError;
  if (eventoError) throw eventoError;
  if (!os) return erro("OS não encontrada.", 404);
  if (!evento) return erro("Evento financeiro não encontrado.", 404);

  const mesesFechados = mesesDeCompetenciaFechada([evento.competencia_em]);
  return {
    ok: true,
    corpo: {
      impacto: analisarExclusaoEventoFinanceiro(evento as any, {
        statusOs: os.status,
        mesesFechados,
      }),
      mesesFechados,
    },
  };
}

export async function analisarExclusaoDoEvento(
  osId: number,
  eventId: number,
): Promise<Resultado<{ impacto: ContextoExclusao["impacto"] }>> {
  const contexto = await carregarImpactoExclusao(osId, eventId);
  if (!contexto.ok) return contexto;
  return { ok: true, corpo: { impacto: contexto.corpo.impacto } };
}

export async function excluirEventoDaOs(
  osId: number,
  eventId: number,
  motivo: string,
  usuarioId: string | null,
): Promise<Resultado<Record<string, unknown>>> {
  const contexto = await carregarImpactoExclusao(osId, eventId);
  if (!contexto.ok) return contexto;

  const { impacto, mesesFechados } = contexto.corpo;
  if (!impacto.podeExcluir) {
    return erro(impacto.bloqueio ?? "Este evento não pode ser excluído.", 409, { impacto });
  }
  if (impacto.exigeMotivo && !motivo) {
    return erro("Informe o motivo para devolver o item ao estoque.", 400);
  }

  const { data, error } = await supabaseAdmin.rpc("excluir_evento_financeiro_manual_os", {
    p_ordemservico_id: osId,
    p_evento_id: eventId,
    p_motivo: motivo || null,
    p_usuario: usuarioId,
  });
  if (error) {
    const mensagem = String(error.message || "");
    const atualizado = await carregarImpactoExclusao(osId, eventId);
    return erro(
      mensagem || "Não foi possível excluir o evento financeiro.",
      /n[aã]o encontrad/i.test(mensagem) ? 404 : 409,
      atualizado.ok ? { impacto: atualizado.corpo.impacto } : undefined,
    );
  }

  return {
    ok: true,
    corpo: {
      excluido: true,
      resultado: data,
      impacto,
      aviso: mesesFechados.length
        ? `A DRE de ${mesesFechados.join(", ")} foi recalculada.`
        : null,
    },
  };
}

// ----------------------------------------------------------------- editar

export async function editarEventoDaOs(
  osId: number,
  eventId: number,
  body: any,
  usuarioId: string | null,
): Promise<Resultado<{ evento: any; aviso: string | null }>> {
  const os = await carregarOs(osId);
  if (!os) return erro("OS não encontrada.", 404);
  const bloqueio = bloqueioDeStatusParaEventos(os.status);
  if (bloqueio) return erro(bloqueio, 409);

  const valor = Number(body?.valor);
  if (!Number.isFinite(valor) || valor < 0) {
    return erro("Informe um valor válido, igual ou maior que zero.", 400);
  }

  const { data: evento, error: eventoError } = await supabaseAdmin
    .from("eventos_financeiros")
    .select("id, origem, natureza, valor, descricao, detalhe, status, transacaoid, dados_snapshot, competencia_em, is_manual")
    .eq("id", eventId)
    .eq("ordemservicoid", osId)
    .neq("status", "CANCELADO")
    .maybeSingle();
  if (eventoError) throw eventoError;
  if (!evento) return erro("Evento financeiro não encontrado.", 404);

  if (evento.status === "CONVERTIDO" || evento.transacaoid) {
    return erro(
      "Exclua a transação vinculada antes de editar este evento financeiro.",
      409,
      { transacaoId: evento.transacaoid },
    );
  }

  const editandoDespesa = evento.natureza === "DESPESA";

  /**
   * Comissão é a exceção à regra da despesa automática.
   *
   * As outras automáticas têm origem corrigível: custo de produto tem o botão
   * de sincronizar, desconto e frete saem do orçamento. Comissão não tem —
   * `valor_comissao` é derivado (`valor_base × percentual efetivo`) e a única
   * entrada humana é quem executou e a taxa do perfil. Quando o cálculo saiu
   * errado numa OS já finalizada, não existia conserto nenhum.
   *
   * O override marca `is_manual`, e isso não é efeito colateral: é o mesmo
   * campo que `reconciliar_eventos_financeiros_os` usa para não recalcular a
   * linha, e o que liga o gatilho de auditoria. Sem ele, o valor corrigido
   * voltaria sozinho no próximo toque no orçamento.
   */
  const overrideDeComissao = editandoDespesa && !evento.is_manual && evento.origem === "COMISSAO";
  if (editandoDespesa && !evento.is_manual && !overrideDeComissao) {
    return erro("Despesas automáticas devem ser corrigidas na origem que gerou o evento.", 409);
  }
  const descricao = editandoDespesa
    ? String(body?.descricao ?? evento.descricao ?? "").trim()
    : evento.descricao;
  const detalhe = editandoDespesa && body?.detalhe !== undefined
    ? String(body.detalhe ?? "").trim() || null
    : evento.detalhe;
  if (editandoDespesa && !descricao) {
    return erro("O título da despesa é obrigatório.", 400);
  }

  const ajustadoEm = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("eventos_financeiros")
    .update({
      descricao,
      detalhe,
      valor: Math.round(valor * 100) / 100,
      is_manual: evento.is_manual || overrideDeComissao,
      updated_at: ajustadoEm,
      dados_snapshot: {
        ...((evento.dados_snapshot as Record<string, unknown> | null) ?? {}),
        ajuste_manual: true,
        ajustado_em: ajustadoEm,
        ajustado_por: usuarioId,
        // Guarda o que o cálculo tinha produzido, para a correção poder ser
        // conferida depois contra a regra automática.
        ...(overrideDeComissao
          ? { comissao_ajustada_a_mao: true, valor_automatico: Number(evento.valor ?? 0) }
          : {}),
      },
    })
    .eq("id", eventId)
    .eq("ordemservicoid", osId)
    .select("*")
    .single();
  if (error) throw error;

  // O valor volta para a competência original do evento, então a DRE do mês
  // em que a execução terminou muda. Não bloqueia — é a regra escolhida —,
  // mas quem alterou precisa saber qual período foi recalculado.
  const mesesRecalculados = mesesDeCompetenciaFechada([evento.competencia_em]);
  return {
    ok: true,
    corpo: {
      evento: data,
      aviso: mesesRecalculados.length
        ? `Este lançamento tem competência em ${mesesRecalculados.join(", ")}. A DRE desse período foi recalculada.`
        : null,
    },
  };
}

// ----------------------------------------------------------- sincronizar

/** A quantidade do snapshot e, na falta dela, a do item na OS. */
async function quantidadeDoEvento(osId: number, evento: any) {
  const doSnapshot = Number(evento.quantidade_snapshot ?? 0);
  if (Number.isFinite(doSnapshot) && doSnapshot > 0) return doSnapshot;
  const { data: item } = await supabaseAdmin
    .from("osproduto")
    .select("quantidade")
    .eq("ordemservicoid", osId)
    .eq("produtoid", evento.produtoid)
    .maybeSingle();
  return Number(item?.quantidade ?? 0);
}

/** A recusa, quando existe. Só a variante de erro: nunca aprova nada por si. */
type Recusa = Extract<Resultado<never>, { ok: false }>;

/** As travas comuns às duas sincronizações de snapshot de produto. */
function bloqueioDeSincronizacao(evento: any): Recusa | null {
  if (evento.status === "CANCELADO") return erro("Este evento financeiro está cancelado.", 409);
  // A transação já lançada não acompanharia o novo valor, e o vínculo exige
  // que os dois sejam iguais.
  if (evento.status === "CONVERTIDO" || evento.transacaoid) {
    return erro(
      "Exclua a transação vinculada antes de sincronizar este evento financeiro.",
      409,
      { transacaoId: evento.transacaoid },
    );
  }
  return null;
}

export async function sincronizarUltimoCustoDoEvento(
  osId: number,
  eventId: number,
): Promise<Resultado<{ evento: any }>> {
  const os = await carregarOs(osId);
  if (!os) return erro("OS não encontrada.", 404);
  const bloqueio = bloqueioDeStatusParaEventos(os.status);
  if (bloqueio) return erro(bloqueio, 409);

  const { data: evento, error: eventoError } = await supabaseAdmin
    .from("eventos_financeiros")
    .select("id, produtoid, quantidade_snapshot, dados_snapshot, valor, origem, natureza, status, transacaoid, competencia_em")
    .eq("id", eventId)
    .eq("ordemservicoid", osId)
    .maybeSingle();
  if (eventoError) throw eventoError;
  if (!evento || evento.origem !== "PRODUTO" || evento.natureza !== "DESPESA") {
    return erro("Este evento não é um snapshot de custo de produto.", 409);
  }
  const travado = bloqueioDeSincronizacao(evento);
  if (travado) return travado;

  const { data: produto, error: produtoError } = await supabaseAdmin
    .from("produto")
    .select("id, ultimovalordecompra, precocompra")
    .eq("id", evento.produtoid)
    .maybeSingle();
  if (produtoError) throw produtoError;
  // Mesma ordem da geração do evento: última entrada e, na falta dela, o preço
  // médio de compra.
  const ultimaEntrada = Number(produto?.ultimovalordecompra ?? 0);
  const precoMedio = Number(produto?.precocompra ?? 0);
  const usaUltimaEntrada = Number.isFinite(ultimaEntrada) && ultimaEntrada > 0;
  const custoUnitario = usaUltimaEntrada ? ultimaEntrada : precoMedio;
  const custoOrigem = usaUltimaEntrada ? "ULTIMA_COMPRA" : "PRECO_MEDIO";
  if (!produto || !Number.isFinite(custoUnitario) || custoUnitario <= 0) {
    return erro("O produto continua sem último valor de entrada nem preço médio de compra.", 409);
  }

  const quantidade = await quantidadeDoEvento(osId, evento);
  const valor = Math.round(custoUnitario * quantidade * 100) / 100;
  const sincronizadoEm = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("eventos_financeiros")
    .update({
      valor,
      valor_unitario_snapshot: custoUnitario,
      quantidade_snapshot: quantidade,
      updated_at: sincronizadoEm,
      dados_snapshot: {
        ...((evento.dados_snapshot as Record<string, unknown> | null) ?? {}),
        custo_nao_informado: false,
        custo_estimado: true,
        custo_origem: custoOrigem,
        ultimo_custo_sincronizado_em: sincronizadoEm,
      },
    })
    .eq("id", eventId)
    .select("*")
    .single();
  if (error) throw error;
  return { ok: true, corpo: { evento: data } };
}

export async function sincronizarValorDeVendaDoEvento(
  osId: number,
  eventId: number,
): Promise<Resultado<{ evento: any }>> {
  const os = await carregarOs(osId);
  if (!os) return erro("OS não encontrada.", 404);
  const bloqueio = bloqueioDeStatusParaEventos(os.status);
  if (bloqueio) return erro(bloqueio, 409);

  const { data: evento, error: eventoError } = await supabaseAdmin
    .from("eventos_financeiros")
    .select("id, produtoid, quantidade_snapshot, dados_snapshot, origem, natureza, status, transacaoid, competencia_em")
    .eq("id", eventId)
    .eq("ordemservicoid", osId)
    .maybeSingle();
  if (eventoError) throw eventoError;
  if (!evento || evento.origem !== "PRODUTO" || evento.natureza !== "RECEITA") {
    return erro("Este evento não é um snapshot de venda de produto.", 409);
  }
  if (!evento.produtoid) {
    return erro("Vincule o produto avulso ao cadastro antes de sincronizar o valor de venda.", 409);
  }
  const travado = bloqueioDeSincronizacao(evento);
  if (travado) return travado;

  const { data: produto, error: produtoError } = await supabaseAdmin
    .from("produto")
    .select("precovenda")
    .eq("id", evento.produtoid)
    .maybeSingle();
  if (produtoError) throw produtoError;
  const precoVenda = Number(produto?.precovenda ?? 0);
  if (!produto || !Number.isFinite(precoVenda) || precoVenda < 0) {
    return erro("O produto não possui valor de venda válido.", 409);
  }

  const quantidade = await quantidadeDoEvento(osId, evento);
  const valor = Math.round(precoVenda * quantidade * 100) / 100;
  const sincronizadoEm = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("eventos_financeiros")
    .update({
      valor,
      valor_unitario_snapshot: precoVenda,
      quantidade_snapshot: quantidade,
      updated_at: sincronizadoEm,
      dados_snapshot: {
        ...((evento.dados_snapshot as Record<string, unknown> | null) ?? {}),
        valor_venda_sincronizado_em: sincronizadoEm,
      },
    })
    .eq("id", eventId)
    .select("*")
    .single();
  if (error) throw error;
  return { ok: true, corpo: { evento: data } };
}
