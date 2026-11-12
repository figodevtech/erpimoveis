import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { comCriadoPor } from "@/lib/financeiro/eventos-autoria";
import { mesesDeCompetenciaFechada } from "@/lib/financeiro/eventos-financeiros/competencia";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { db, ImobError, internal, one, rpc } from "./server";
import { respostaSeEdicaoBloqueada } from "@/app/api/transaction/_lib/edicao";
import { exigirAcessoATransacao } from "@/app/api/transaction/_lib/autoria";
import { civilDate } from "./schemas";
import { financeAccess } from "./finance";
import { hojeImobiliario } from "./types";

/**
 * Eventos financeiros da reserva (aba "Eventos financeiros" do diálogo).
 *
 * Duas fontes, porque são dois donos de dinheiro:
 * - `eventos_financeiros`: os lançamentos da reserva, inclusive seu valor bruto informativo,
 *   criado pelo banco somente no check-out. A receita da DRE é a taxa de administração
 *   (automática, nasce quando o cliente paga); ela não aparece na lista, porque no painel ela é o
 *   resultado da reserva, e só entra nos totais. O valor de cada uma pode ser ajustado pelo
 *   botão "Ajustar taxa" do cartão Receitas, o que corrige a DRE e o extrato. Os custos são lançados aqui (origem
 *   DESPESA_RESERVA). Entra na DRE pela competência; vai ao caixa pelo lançamento de eventos.
 * - `imovel_lancamento`: a conta do proprietário. Despesa que ele arca (ex.: a limpeza), deduzida
 *   do repasse, e o repasse. Abate o saldo a repassar no extrato e fica fora da DRE.
 */

const EVENTO_FIELDS =
  "id, source_type, source_id, origem, natureza, natureza_dre, status, descricao, detalhe, valor, "
  + "data_evento, competencia_em, chave_origem, is_manual, pode_gerar_transacao, transacaoid, lancamento_id, "
  + "percentual_snapshot, valor_base_snapshot, dados_snapshot, created_by, created_at, updated_at";

const SEM_MIGRATION = ["42703", "PGRST204", "PGRST200", "42P01", "PGRST205"];

const novoSchema = z.object({
  tipo: z.enum(["CUSTO", "DESPESA_PROPRIETARIO", "REPASSE"]),
  descricao: z.string().trim().min(1, "Informe o título.").max(200),
  detalhe: z.string().trim().max(2000).nullish(),
  valor: z.coerce.number().finite().positive("Informe um valor maior que zero.").max(1e12),
  data: civilDate.nullish(),
  idempotency_key: z.string().trim().min(8).max(100).nullish(),
});

const edicaoSchema = z.object({
  descricao: z.string().trim().min(1, "Informe o título.").max(200).optional(),
  detalhe: z.string().trim().max(2000).nullish(),
  valor: z.coerce.number().finite().positive("Informe um valor maior que zero.").max(1e12).optional(),
  data: civilDate.nullish(),
  atualizado_em: z.string().datetime({ offset: true }).optional(),
});

const centavos = (valor: unknown) => Math.round(Number(valor ?? 0) * 100);
const reais = (cents: number) => cents / 100;

function falhaRpc(error: unknown): never {
  const e = error as { code?: string; message?: string };
  // Sem a migration 20261108120000 aplicada, a função não existe: diz isso em vez de 500.
  if (["PGRST202", "42883"].includes(String(e?.code))) {
    throw new ImobError(503, "Esta operação ainda não está disponível neste banco. Aplique as migrations pendentes dos eventos financeiros da reserva.");
  }
  throw error;
}

const RESERVA_FIELDS = "id,status,inicio,fim,valor_total,percentual_admin,imovel_id,proprietario_id,financeiro_status";

async function reservaDoEvento(reservaId: number) {
  return one("reserva_imovel", reservaId, RESERVA_FIELDS);
}

export async function listarEventosDaReserva(reservaId: number) {
  await financeAccess({ reserva_id: reservaId });
  // O nome do proprietário vai no título sugerido do repasse.
  // O documento vai junto para o diálogo do repasse abrir com o proprietário como recebedor.
  const reserva = await one("reserva_imovel", reservaId, `${RESERVA_FIELDS},proprietario:proprietario_id(id,nomerazaosocial,cpfcnpj)`);

  const [custos, taxas, lancamentos, recebimentos] = await Promise.all([
    db.from("eventos_financeiros").select(EVENTO_FIELDS)
      .eq("source_type", "RESERVA").eq("source_id", reservaId).neq("status", "CANCELADO")
      .order("competencia_em", { ascending: false }).order("id", { ascending: false }),
    // Taxa de administração e o estorno dela: a receita da imobiliária nesta reserva.
    db.from("eventos_financeiros").select(EVENTO_FIELDS)
      .eq("source_type", "IMOVEL_TAXA").contains("dados_snapshot", { reserva_id: reservaId })
      .order("competencia_em", { ascending: false }).order("id", { ascending: false }),
    db.from("imovel_lancamento")
      .select("id,natureza,valor,data,competencia_em,descricao,cancelado_em,created_by,created_at,updated_at,transacao:transacao_id(id,pendente,is_deleted,valor,pago_em,vencimento_em,data)")
      .eq("reserva_id", reservaId).is("cancelado_em", null)
      .order("data", { ascending: false }).order("id", { ascending: false }),
    // O que o hóspede já pagou: o bruto recebido no extrato, estornos inclusos (valor negativo).
    db.from("imovel_movimento").select("valor").eq("reserva_id", reservaId).eq("tipo", "BRUTO_RECEBIDO"),
  ]);
  if (recebimentos.error) throw recebimentos.error;
  // A constraint de source_type sem RESERVA não impede a leitura; só a coluna nova da conta do proprietário pode faltar.
  if (custos.error) throw custos.error;
  if (taxas.error) throw taxas.error;
  if (lancamentos.error && !SEM_MIGRATION.includes(String(lancamentos.error.code))) throw lancamentos.error;

  // A taxa de administração não é um lançamento do painel: ela é o resultado da reserva (valor
  // menos repasses e despesas do proprietário). Continua sendo a receita da DRE e entra nos totais.
  const taxasAtivas = (taxas.data ?? []).filter((evento: any) => evento.status !== "CANCELADO");
  const eventos = await comCriadoPor(custos.data ?? []);

  // Parcelas no financeiro dos custos já lançados: o evento aponta para o grupo, não para a transação.
  const grupos = [...new Set(eventos.map((evento: any) => evento.lancamento_id).filter((id: unknown) => id != null))];
  const parcelasPorGrupo = new Map<number, Record<string, unknown>[]>();
  if (grupos.length) {
    const parcelas = await db.from("transacao").select("id,lancamento_id,pendente,valor,tipo,pago_em,vencimento_em,data")
      .in("lancamento_id", grupos).eq("is_deleted", false).order("vencimento_em", { ascending: true }).order("id");
    if (parcelas.error) throw parcelas.error;
    for (const parcela of parcelas.data ?? []) {
      const lista = parcelasPorGrupo.get(Number(parcela.lancamento_id)) ?? [];
      lista.push(parcela);
      parcelasPorGrupo.set(Number(parcela.lancamento_id), lista);
    }
  }

  const linhas = eventos.map((evento: any) => ({
    ...evento,
    informativo: evento.origem === "RECEITA_RESERVA",
    automatico: evento.source_type !== "RESERVA" || evento.origem === "RECEITA_RESERVA",
    parcelas: evento.lancamento_id != null ? parcelasPorGrupo.get(Number(evento.lancamento_id)) ?? [] : [],
  }));
  const ajustesPorConta = new Map<number, Record<string, any>[]>();
  const contasIds = (lancamentos.data ?? []).map((linha: any) => Number(linha.id));
  if (contasIds.length) {
    const ajustes = await db.from("transacao").select("id,imovel_lancamento_contabil_id,pendente,valor,tipo,pago_em,vencimento_em,data")
      .in("imovel_lancamento_contabil_id", contasIds).eq("is_deleted", false).is("baixa_de_transacao_id", null).order("id");
    if (ajustes.error) throw ajustes.error;
    for (const ajuste of ajustes.data ?? []) {
      const chave = Number(ajuste.imovel_lancamento_contabil_id);
      ajustesPorConta.set(chave, [...(ajustesPorConta.get(chave) ?? []), ajuste]);
    }
  }
  // O lançamento permanece vinculado enquanto houver uma transação ou ajuste vivo.
  const conta = (lancamentos.data ?? []).map((linha: any) => ({
    ...linha,
    transacao: linha.transacao && !linha.transacao.is_deleted ? linha.transacao : ajustesPorConta.get(Number(linha.id))?.[0] ?? null,
    parcelas: [...(linha.transacao && !linha.transacao.is_deleted ? [linha.transacao] : []), ...(ajustesPorConta.get(Number(linha.id)) ?? [])],
  }));

  const soma = (lista: any[], filtro: (linha: any) => boolean) => reais(lista.filter(filtro).reduce((total, linha) => total + centavos(linha.valor), 0));
  const receita = soma(taxasAtivas, (linha) => linha.natureza === "RECEITA");
  const estornos = soma(taxasAtivas, (linha) => linha.natureza === "DESPESA");
  const custosTotal = soma(linhas, (linha) => !linha.automatico && linha.natureza === "DESPESA");
  const custosNoFinanceiro = soma(linhas, (linha) => !linha.automatico && linha.lancamento_id != null);
  // Só o que ainda será pago vai ao caixa; o consumo de estoque já foi pago na compra do item.
  const custosALancar = soma(linhas, (linha) => !linha.automatico && linha.lancamento_id == null && linha.pode_gerar_transacao === true);
  const consumoEstoque = soma(linhas, (linha) => !linha.automatico && linha.origem === "CONSUMO");
  const repasses = soma(conta, (linha) => linha.natureza === "REPASSE");
  const despesasProprietario = soma(conta, (linha) => linha.natureza === "DESPESA_PROPRIETARIO");
  const recebido = soma(recebimentos.data ?? [], () => true);
  const ajusteTaxa = (taxas.data ?? []).filter((linha: any) => linha.dados_snapshot?.taxa_admin_ajustada === true
      && (linha.status !== "CANCELADO" || linha.dados_snapshot?.excluido_manualmente === true))
    .reduce((total: number, linha: any) => total + (linha.natureza === "RECEITA" ? 1 : -1)
      * (centavos(linha.valor) - centavos(linha.dados_snapshot.taxa_admin_valor_automatico)), 0);

  return {
    reserva,
    eventos: linhas,
    // Fora da lista, mas ajustáveis pelo cartão "Receitas": uma por pagamento (ou reembolso) do hóspede.
    taxas: taxasAtivas,
    lancamentos: conta,
    // Sem a coluna reserva_id em imovel_lancamento, a seção da conta do proprietário fica de fora.
    contaProprietarioDisponivel: !lancamentos.error,
    totais: {
      receita,
      estornos,
      receita_liquida: reais(centavos(receita) - centavos(estornos)),
      // O que a taxa renderá quando todo o valor da reserva for recebido.
      receita_prevista: reais(Math.round(centavos(reserva.valor_total) * Number(reserva.percentual_admin ?? 0) / 100) + ajusteTaxa),
      custos: custosTotal,
      custos_no_financeiro: custosNoFinanceiro,
      custos_a_lancar: custosALancar,
      consumo_estoque: consumoEstoque,
      resultado: reais(centavos(receita) - centavos(estornos) - centavos(custosTotal)),
      repasses,
      despesas_proprietario: despesasProprietario,
      // Visão de gestão da reserva, não da DRE: o total cobrado do hóspede contra tudo o que sai
      // por causa dela (custos da imobiliária, despesas que o proprietário arca e repasses). Com
      // tudo registrado, o que sobra é a taxa de administração menos os custos.
      receita_reserva: Number(reserva.valor_total ?? 0),
      recebido,
      saidas: reais(centavos(custosTotal) + centavos(despesasProprietario) + centavos(repasses)),
      resultado_previsto: reais(centavos(reserva.valor_total) - centavos(custosTotal) - centavos(despesasProprietario) - centavos(repasses)),
    },
  };
}

export async function criarEventoDaReserva(reservaId: number, body: Record<string, unknown>) {
  const access = await financeAccess({ reserva_id: reservaId }, true);
  const data = novoSchema.parse(body);
  const reserva = await reservaDoEvento(reservaId);
  if (reserva.status === "CANCELADA") throw new ImobError(409, "Reserva cancelada não recebe novos lançamentos.");

  if (data.tipo === "CUSTO") {
    const evento = await rpc("imob_criar_evento_reserva", {
      p_reserva_id: reservaId, p_descricao: data.descricao, p_detalhe: data.detalhe ?? null,
      p_valor: data.valor, p_data: data.data ?? null, p_usuario: access.id,
    }).catch(falhaRpc);
    return { evento, aviso: avisoDeCompetencia(evento?.competencia_em) };
  }

  // Banco sem a migration ignoraria reserva_id em silêncio: o lançamento entraria no extrato
  // e sumiria desta aba. Confere a coluna antes de gravar qualquer coisa.
  const coluna = await db.from("imovel_lancamento").select("reserva_id").limit(1);
  if (coluna.error) {
    if (SEM_MIGRATION.includes(String(coluna.error.code))) {
      throw new ImobError(503, "Aplique a migration 20261108120000 para vincular lançamentos à reserva.");
    }
    throw coluna.error;
  }

  // Conta do proprietário: o lançamento contábil de sempre, agora com a reserva.
  const lancamento = await rpc("imob_registrar_lancamento", {
    p_payload: {
      tipo: data.tipo, valor: data.valor, descricao: data.descricao, data: data.data ?? hojeImobiliario(),
      imovel_id: reserva.imovel_id, proprietario_id: reserva.proprietario_id, reserva_id: reservaId,
      idempotency_key: data.idempotency_key ?? randomUUID(),
    },
    p_actor: access.id,
  });
  return { lancamento };
}

export async function alterarEventoDaReserva(reservaId: number, eventoId: number, operacao: "EDITAR" | "EXCLUIR", body: Record<string, unknown>) {
  const access = await financeAccess({ reserva_id: reservaId }, true);
  const payload = operacao === "EDITAR" ? edicaoSchema.parse(body) : {};
  if (operacao === "EDITAR") {
    const evento = await one("eventos_financeiros", eventoId);
    if (!((evento.source_type === "RESERVA" && Number(evento.source_id) === reservaId)
      || (evento.source_type === "IMOVEL_TAXA" && Number(evento.dados_snapshot?.reserva_id) === reservaId))) {
      throw new ImobError(404, "Evento não encontrado nesta reserva.");
    }
    if (evento.lancamento_id != null || evento.transacaoid != null) {
      await exigirEdicaoFinanceira(evento.transacaoid != null ? [Number(evento.transacaoid)] : []);
      if (evento.lancamento_id != null) {
        const parcelas = await db.from("transacao").select("id").eq("lancamento_id", evento.lancamento_id).eq("is_deleted", false);
        if (parcelas.error) throw parcelas.error;
        await conferirAutoria((parcelas.data ?? []).map((parcela: any) => Number(parcela.id)));
      }
    }
  }
  const resultado = await rpc("imob_alterar_evento_reserva", {
    p_reserva_id: reservaId, p_evento_id: eventoId, p_operacao: operacao,
    p_payload: { ...payload, pode_editar_financeiro: permissionSetHas(access.permissoes, PERMS.FINANCEIRO_EDITAR) }, p_usuario: access.id,
  }).catch(falhaRpc);
  return { resultado, aviso: [avisoDeCompetencia(resultado?.competencia_em), avisoDeAjuste(resultado)].filter(Boolean).join(" ") || null };
}

async function exigirEdicaoFinanceira(ids: number[] = []) {
  await internal(PERMS.FINANCEIRO_EDITAR);
  const bloqueio = await respostaSeEdicaoBloqueada();
  if (bloqueio) throw new ImobError(bloqueio.status, (await bloqueio.json()).error);
  await conferirAutoria(ids);
}

async function conferirAutoria(ids: number[]) {
  if (!ids.length) return;
  try { await exigirAcessoATransacao(ids); }
  catch (error) {
    const falha = error as { statusCode?: number; message?: string };
    if (falha.statusCode) throw new ImobError(falha.statusCode, falha.message ?? "Você não tem acesso à transação vinculada.");
    throw error;
  }
}

export async function editarLancamentoDaReserva(reservaId: number, lancamentoId: number, body: Record<string, unknown>) {
  const access = await financeAccess({ reserva_id: reservaId }, true);
  const payload = edicaoSchema.parse(body);
  const lancamento = await one("imovel_lancamento", lancamentoId);
  if (Number(lancamento.reserva_id) !== reservaId) throw new ImobError(404, "Lançamento não encontrado nesta reserva.");
  if (lancamento.transacao_id != null) {
    const transacao = await one("transacao", Number(lancamento.transacao_id));
    if (!transacao.is_deleted) await exigirEdicaoFinanceira([Number(transacao.id)]);
  }
  const ajustes = await db.from("transacao").select("id").eq("imovel_lancamento_contabil_id", lancamentoId).eq("is_deleted", false);
  if (ajustes.error) throw ajustes.error;
  if (ajustes.data?.length) await exigirEdicaoFinanceira(ajustes.data.map((ajuste: any) => Number(ajuste.id)));
  const resultado = await rpc("imob_editar_lancamento_reserva", {
    p_reserva_id: reservaId, p_lancamento_id: lancamentoId,
    p_payload: { ...payload, pode_editar_financeiro: permissionSetHas(access.permissoes, PERMS.FINANCEIRO_EDITAR) }, p_actor: access.id,
  }).catch(falhaRpc);
  return { resultado, aviso: avisoDeAjuste(resultado) };
}

function avisoDeAjuste(resultado: any) {
  return resultado?.ajuste_transacao_id ? `A diferença foi registrada no financeiro como ajuste a pagar ou receber (#${resultado.ajuste_transacao_id}).` : null;
}

const exclusaoSchema = z.object({ atualizado_em: z.string().datetime({ offset: true }).optional() });

export async function excluirEventoDaReserva(reservaId: number, eventoId: number, body: Record<string, unknown> = {}) {
  const access = await financeAccess({ reserva_id: reservaId }, true);
  const payload = exclusaoSchema.parse(body);
  const evento = await one("eventos_financeiros", eventoId);
  if (!((evento.source_type === "RESERVA" && Number(evento.source_id) === reservaId)
    || (evento.source_type === "IMOVEL_TAXA" && Number(evento.dados_snapshot?.reserva_id) === reservaId))) {
    throw new ImobError(404, "Evento não encontrado nesta reserva.");
  }
  if (evento.origem === "CONSUMO") exigirEstoque(access.permissoes, evento.consumo_saida_id != null ? "PRODUTO" : "USOCONSUMO");
  if (evento.lancamento_id != null || evento.transacaoid != null) {
    await internal(PERMS.FINANCEIRO_EXCLUIR);
    if (evento.transacaoid != null) await conferirAutoria([Number(evento.transacaoid)]);
    if (evento.lancamento_id != null) {
      const parcelas = await db.from("transacao").select("id").eq("lancamento_id", evento.lancamento_id).eq("is_deleted", false);
      if (parcelas.error) throw parcelas.error;
      await conferirAutoria((parcelas.data ?? []).map((parcela: any) => Number(parcela.id)));
    }
  }
  const resultado = await rpc("imob_excluir_evento_reserva", {
    p_reserva_id: reservaId, p_evento_id: eventoId, p_usuario: access.id,
    p_payload: { ...payload, pode_excluir_financeiro: permissionSetHas(access.permissoes, PERMS.FINANCEIRO_EXCLUIR) },
  }).catch(falhaRpc);
  return { resultado, aviso: avisoDeAjuste(resultado) };
}

export async function excluirLancamentoDaReserva(reservaId: number, lancamentoId: number, body: Record<string, unknown> = {}) {
  const access = await financeAccess({ reserva_id: reservaId }, true);
  const payload = exclusaoSchema.parse(body);
  const lancamento = await one("imovel_lancamento", lancamentoId);
  if (Number(lancamento.reserva_id) !== reservaId) throw new ImobError(404, "Lançamento não encontrado nesta reserva.");
  const vinculos = await db.from("transacao").select("id")
    .or(`id.eq.${Number(lancamento.transacao_id) || 0},imovel_lancamento_contabil_id.eq.${lancamentoId}`).eq("is_deleted", false);
  if (vinculos.error) throw vinculos.error;
  if (vinculos.data?.length) {
    await internal(PERMS.FINANCEIRO_EXCLUIR);
    await conferirAutoria(vinculos.data.map((linha: any) => Number(linha.id)));
  }
  const resultado = await rpc("imob_excluir_lancamento_reserva", {
    p_reserva_id: reservaId, p_lancamento_id: lancamentoId, p_usuario: access.id,
    p_payload: { ...payload, pode_excluir_financeiro: permissionSetHas(access.permissoes, PERMS.FINANCEIRO_EXCLUIR) },
  }).catch(falhaRpc);
  return { resultado, aviso: avisoDeAjuste(resultado) };
}

/**
 * Estorno de despesa do proprietário ou repasse lançado na reserva. Pelo escopo da reserva,
 * para quem tem o financeiro dela mas não o do imóvel; a regra (sem transação viva) é do banco.
 */
export async function estornarLancamentoDaReserva(reservaId: number, lancamentoId: number) {
  const access = await financeAccess({ reserva_id: reservaId }, true);
  const lancamento = await one("imovel_lancamento", lancamentoId);
  if (Number(lancamento.reserva_id) !== reservaId) throw new ImobError(404, "Lançamento não encontrado nesta reserva.");
  return { item: await rpc("imob_cancelar_lancamento", { p_id: lancamentoId, p_actor: access.id }) };
}

const consumoSchema = z.object({
  escopo: z.enum(["PRODUTO", "USOCONSUMO", "GERAL"]),
  itemId: z.coerce.number().int().positive(),
  quantidade: z.coerce.number().int().positive("A quantidade deve ser maior que zero."),
  descricao: z.string().trim().min(1, "Informe o título do custo.").max(200),
  observacao: z.string().trim().max(500).nullish(),
  /** Ausente = custo do cadastro. Presente = correção manual, e a RPC marca a linha. */
  valor: z.coerce.number().finite().nonnegative().max(1e12).optional(),
  data: civilDate.nullish(),
});

/** Quem dá baixa precisa poder mexer naquele estoque, não só no financeiro da reserva. */
function exigirEstoque(permissoes: unknown, escopo: "PRODUTO" | "USOCONSUMO" | "GERAL") {
  const permissao = escopo === "PRODUTO" ? PERMS.ESTOQUE_EDITAR : PERMS.USOCONSUMO_SAIDA;
  if (!permissionSetHas(permissoes as string[] | undefined, permissao)) {
    throw new ImobError(403, escopo === "PRODUTO"
      ? "Seu perfil não pode dar baixa no estoque de produtos."
      : "Seu perfil não pode registrar saída no estoque de uso e consumo.");
  }
}

/**
 * Consumo de estoque na reserva (sabonete, toalha): baixa o item e lança o custo pelo preço de
 * custo, numa transação só no banco. É custo da imobiliária na DRE e não vai ao caixa.
 */
export async function registrarConsumoDaReserva(reservaId: number, body: Record<string, unknown>) {
  const access = await financeAccess({ reserva_id: reservaId }, true);
  const data = consumoSchema.parse(body);
  exigirEstoque(access.permissoes, data.escopo);
  const resultado = await rpc("imob_registrar_consumo_reserva", {
    p_payload: {
      reserva_id: reservaId, escopo: data.escopo, item_id: data.itemId, quantidade: data.quantidade,
      descricao: data.descricao, observacao: data.observacao ?? null, valor: data.valor ?? null,
      data: data.data ?? null, created_by: access.id,
    },
  }).catch(falhaDoEstoque);
  return { resultado, aviso: avisoDeCompetencia(resultado?.competencia_em) };
}

/** Cancela o consumo: o item volta ao estoque e o custo sai da DRE. */
export async function cancelarConsumoDaReserva(reservaId: number, eventoId: number, body: Record<string, unknown>) {
  const access = await financeAccess({ reserva_id: reservaId }, true);
  const motivo = z.string().trim().min(3, "Informe o motivo do cancelamento.").max(500).parse(body.motivo);
  const evento = await one("eventos_financeiros", eventoId, "id,source_type,source_id,consumo_saida_id");
  if (evento.source_type !== "RESERVA" || Number(evento.source_id) !== reservaId) {
    throw new ImobError(404, "Consumo não encontrado nesta reserva.");
  }
  exigirEstoque(access.permissoes, evento.consumo_saida_id != null ? "PRODUTO" : "USOCONSUMO");
  const resultado = await rpc("imob_cancelar_consumo_reserva", {
    p_reserva_id: reservaId, p_evento_id: eventoId, p_motivo: motivo, p_usuario: access.id,
  }).catch(falhaDoEstoque);
  return { resultado, aviso: avisoDeCompetencia(resultado?.competencia_em) };
}

/** Saldo insuficiente é regra de negócio do estoque, não falha do servidor. */
function falhaDoEstoque(error: unknown): never {
  const e = error as { code?: string; message?: string };
  if (String(e?.message ?? "").includes("Estoque insuficiente") || e?.code === "23514") {
    throw new ImobError(409, e?.message || "Estoque insuficiente para esta baixa.");
  }
  return falhaRpc(error);
}

/** Mexer num mês que já passou reescreve a DRE dele; o operador precisa saber. */
function avisoDeCompetencia(competencia: unknown) {
  const meses = mesesDeCompetenciaFechada([competencia]);
  return meses.length ? `A competência deste evento é ${meses.join(", ")}: a DRE desse período foi recalculada.` : null;
}
