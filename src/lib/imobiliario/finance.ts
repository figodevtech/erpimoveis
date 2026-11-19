import "server-only";
import { permissionSetHas } from "@/app/api/_authz/permission-constants";
import { getCurrentUserAccess } from "@/app/api/_authz/perms";
import { db, identifier, ImobError, one, rpc } from "./server";
import { civilDate } from "./schemas";
import { consolidarMovimentos } from "./extrato-consolidado";
import { hojeImobiliario } from "./types";

const scopes = {
  proprietario_id: ["proprietarios:financeiro", "proprietario_id"], imovel_id: ["imoveis:financeiro", "imovel_id"],
  reserva_id: ["reservas:financeiro", "reserva_imovel_id"],
} as const;
export type FinanceScope = Partial<Record<keyof typeof scopes, number>>;

export function scopeFromUrl(url: URL): FinanceScope {
  const scope: FinanceScope = {};
  for (const key of Object.keys(scopes) as Array<keyof typeof scopes>) {
    const v = url.searchParams.get(key);
    if (v) scope[key] = identifier(v);
  }
  if (url.searchParams.has("contexto_id")) {
    const key = ({ IMOVEL: "imovel_id", PROPRIETARIO: "proprietario_id", RESERVA: "reserva_id" } as Record<string, keyof typeof scopes>)[String(url.searchParams.get("contexto_tipo")).toUpperCase()];
    if (!key) throw new ImobError(400, "Informe o tipo do contexto financeiro.");
    scope[key] = identifier(url.searchParams.get("contexto_id"));
  }
  return scope;
}

export async function financeAccess(scope: FinanceScope, write: boolean | "pay" = false) {
  const access = await getCurrentUserAccess();
  if (!access?.ativo) throw new ImobError(401, "Entre no ERP para continuar.");
  if (permissionSetHas(access.permissoes, write ? "financeiro:criar" : "financeiro:visualizar")) return access;
  if (write === "pay" && permissionSetHas(access.permissoes, "financeiro:editar")) return access;
  const first = (Object.keys(scopes) as Array<keyof typeof scopes>).find((k) => scope[k]);
  if (!first || !permissionSetHas(access.permissoes, scopes[first][0])) throw new ImobError(403, "Você não tem acesso ao financeiro desta operação.");
  return access;
}

function scoped(query: any, scope: FinanceScope, transaction = false) {
  for (const [key, value] of Object.entries(scope)) query = query.eq(transaction ? scopes[key as keyof typeof scopes][1] : key, value);
  return query;
}

/**
 * Movimentos de lançamentos gravados antes de 20261112120000 não têm reserva_id (o vínculo
 * fica no lançamento). Sem completar, o portal não os mostra na página da reserva.
 */
async function completarReserva(items: Record<string, any>[]) {
  const ids = [...new Set(items.filter((r) => r.lancamento_id != null && r.reserva_id == null).map((r) => Number(r.lancamento_id)))];
  const reservaDoLancamento = new Map<number, unknown>();
  for (let i = 0; i < ids.length; i += 200) {
    const result = await db.from("imovel_lancamento").select("id,reserva_id").in("id", ids.slice(i, i + 200)).not("reserva_id", "is", null);
    // Banco sem a coluna reserva_id em imovel_lancamento: segue sem completar.
    if (result.error) {
      if (["42703", "PGRST204"].includes(String(result.error.code))) return;
      throw result.error;
    }
    for (const l of result.data ?? []) reservaDoLancamento.set(Number(l.id), l.reserva_id);
  }
  for (const r of items) if (r.reserva_id == null && reservaDoLancamento.has(Number(r.lancamento_id))) r.reserva_id = reservaDoLancamento.get(Number(r.lancamento_id));
}

/**
 * Repasses registrados que ainda não foram pagos. Desde 20261112120000 eles não estão no razão
 * (a dívida com o proprietário só é quitada no pagamento); o portal os mostra como "(pendente)",
 * fora dos totais e do saldo. Uma linha por lançamento, com o que falta pagar dele.
 */
async function repassesPendentes(scope: FinanceScope, pagos: Record<string, any>[]) {
  if (Object.keys(scope).some((k) => !["proprietario_id", "imovel_id", "reserva_id"].includes(k))) return [];
  let query = db.from("imovel_lancamento").select("id,imovel_id,proprietario_id,reserva_id,valor,data,descricao,imovel:imovel_id(id,titulo)")
    .eq("natureza", "REPASSE").is("cancelado_em", null).limit(1000);
  for (const [key, value] of Object.entries(scope)) query = query.eq(key, value);
  const { data, error } = await query;
  if (error) {
    if (["42703", "PGRST204", "42P01", "PGRST205"].includes(String(error.code))) return [];
    throw error;
  }
  const pago = new Map<number, number>();
  for (const r of pagos) if (r.tipo === "REPASSE" && r.lancamento_id != null) pago.set(Number(r.lancamento_id), (pago.get(Number(r.lancamento_id)) ?? 0) + Math.round(Number(r.valor) * 100));
  return (data ?? []).flatMap((l: any) => {
    const falta = Math.round(Number(l.valor) * 100) - (pago.get(Number(l.id)) ?? 0);
    if (falta <= 0) return [];
    return [{
      // Id negativo: não colide com os do razão e serve de chave na tela.
      id: -Number(l.id), lancamento_id: l.id, tipo: "REPASSE", valor: falta / 100, repasse_pendente: true,
      imovel_id: l.imovel_id, proprietario_id: l.proprietario_id, reserva_id: l.reserva_id, imovel: l.imovel,
      descricao: l.descricao, data_movimento: new Date(`${l.data}T12:00:00-03:00`).toISOString(),
    }];
  });
}

/** `consolidar`: uma linha por pagamento/lançamento, como o portal do proprietário mostra. */
export async function financeReport(scope: FinanceScope, url: URL, opcoes: { consolidar?: boolean } = {}) {
  const inicio = url.searchParams.get("inicio"); const fim = url.searchParams.get("fim");
  if (inicio) civilDate.parse(inicio);
  if (fim) civilDate.parse(fim);
  if (inicio && fim && fim < inicio) throw new ImobError(400, "Período inválido.");
  const items: Record<string, any>[] = [];
  for (let offset = 0; ; offset += 1000) {
    const query = scoped(db.from("imovel_movimento").select("*,imovel:imovel_id(id,titulo)").order("data_movimento", { ascending: false }).order("id", { ascending: false }), scope);
    const { data, error } = await query.range(offset, offset + 999);
    if (error) throw error;
    items.push(...data);
    if (data.length < 1000) break;
  }
  await completarReserva(items);
  const saldoAtual = Math.round(items.reduce((s, r) => s + (r.tipo === "BRUTO_RECEBIDO" ? 1 : -1) * Number(r.valor), 0) * 100) / 100;
  // Portal: repasses ainda não pagos entram como linhas "(pendente)", fora dos totais e do saldo.
  const comPendentes = opcoes.consolidar ? [...items, ...(await repassesPendentes(scope, items))] : items;
  // Consolida antes do filtro de período: o ajuste fica na data do pagamento, não na do ajuste.
  const filtered = (opcoes.consolidar ? consolidarMovimentos(comPendentes) : items).filter((r) => (!inicio || Date.parse(r.data_movimento) >= Date.parse(`${inicio}T00:00:00-03:00`)) && (!fim || Date.parse(r.data_movimento) < Date.parse(`${fim}T00:00:00-03:00`) + 86400000));
  const sum = (tipo: string) => Math.round(filtered.filter((r) => r.tipo === tipo && !r.repasse_pendente).reduce((s, r) => s + Number(r.valor), 0) * 100) / 100;
  const recebido = sum("BRUTO_RECEBIDO"), receita_administradora = sum("TAXA_ADMIN"), despesas = sum("DESPESA_PROPRIETARIO"), repassado = sum("REPASSE");
  const tx = await scoped(db.from("transacao").select("id,descricao,valor,valorLiquido,valor_baixado,pendente,data,vencimento_em,pago_em,tipo,created_at,imovel_id,proprietario_id,reserva_imovel_id,imovel_natureza,imovel_competencia,banco_id,metodopagamento,banco:bancoconta!transacao_banco_id_fkey(id,titulo)").eq("is_deleted", false).not("imovel_id", "is", null).is("baixa_de_transacao_id", null).order("data", { ascending: false }).limit(1000), scope, true);
  if (tx.error) throw tx.error;
  // Lançamentos contábeis são do imóvel e do proprietário; a reserva não os tem.
  let lancamentos: Record<string, any>[] = [];
  if (Object.keys(scope).every((k) => k === "imovel_id" || k === "proprietario_id")) {
    let query = scoped(db.from("imovel_lancamento").select("*,imovel:imovel_id(id,titulo),proprietario:proprietario_id(id,nomerazaosocial,cpfcnpj),transacao:transacao_id(id,tipo,pendente,is_deleted,valor,valorLiquido,valor_baixado,data,pago_em,metodopagamento,banco:bancoconta!transacao_banco_id_fkey(id,titulo))")
      .order("data", { ascending: false }).order("id", { ascending: false }).limit(1000), scope);
    if (inicio) query = query.gte("data", inicio);
    if (fim) query = query.lte("data", fim);
    const result = await query;
    // Sem a migration do lançamento contábil aplicada, o relatório segue sem a seção.
    const semTabela = result.error && ["42P01", "PGRST205", "PGRST200"].includes(String(result.error.code));
    if (result.error && !semTabela) throw result.error;
    // Transação excluída no financeiro não conta: o lançamento volta a poder ser lançado.
    lancamentos = (result.data ?? []).map((r: any) => ({ ...r, transacao: r.transacao && !r.transacao.is_deleted ? r.transacao : null }));
  }
  // Na reserva, a aba Pagamentos lança contra o total dela e sugere o cliente como pagador.
  let reserva: Record<string, any> | null = null;
  if (scope.reserva_id) {
    const result = await db.from("reserva_imovel").select("id,valor_total,status,cliente_id,cliente:cliente_id(id,nomerazaosocial,cpfcnpj)").eq("id", scope.reserva_id).maybeSingle();
    if (result.error) throw result.error;
    reserva = result.data;
  }
  return { items: filtered.map((r) => ({ ...r, data: r.data_movimento })),
    lancamentos, reserva,
    totais: { recebido, receita_administradora, despesas, repassado, saldo_repassar: saldoAtual, saldo_periodo: Math.round((recebido - receita_administradora - despesas - repassado) * 100) / 100 },
    cobrancas: (tx.data ?? []).filter((r: any) => !["REPASSE", "DESPESA_PROPRIETARIO"].includes(r.imovel_natureza)).map((r: any) => ({ ...r, vencimento: r.data, valor_pago: Number(r.valor_baixado ?? 0) || (r.pendente ? 0 : Number(r.valorLiquido ?? r.valor)), status: r.pendente ? Number(r.valor_baixado) > 0 ? "PARCIAL" : "PENDENTE" : "PAGO" })),
    repasses: (tx.data ?? []).filter((r: any) => r.imovel_natureza === "REPASSE"),
    despesas: (tx.data ?? []).filter((r: any) => r.imovel_natureza === "DESPESA_PROPRIETARIO"), periodo: { inicio, fim },
  };
}

export async function payCharge(id: number, body: Record<string, any>, actor: string) {
  const tx = await one("transacao", id);
  if (!tx.imovel_id) throw new ImobError(400, "Esta cobrança não pertence ao imobiliário.");
  const valor = body.valor == null ? null : Number(body.valor);
  if (valor != null && (!Number.isFinite(valor) || valor <= 0)) throw new ImobError(400, "Informe um valor positivo.");
  const metodo = String(body.metodo_pagamento ?? body.metodopagamento ?? "").trim().slice(0, 80);
  if (!metodo) throw new ImobError(400, "Informe o método de pagamento.");
  const day = civilDate.parse(body.data ?? hojeImobiliario());
  return rpc("baixar_transacao_pendente", { p_transacao_id: id, p_pago_em: `${day}T12:00:00-03:00`, p_banco_id: identifier(body.banco_id), p_metodopagamento: metodo,
    p_plano_de_conta_id: null, p_centro_custo_id: null, p_baixado_por: actor, p_valor: valor, p_valor_lancado: null, p_ajustes: null });
}
