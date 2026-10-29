import "server-only";
import { permissionSetHas } from "@/app/api/_authz/permission-constants";
import { getCurrentUserAccess } from "@/app/api/_authz/perms";
import { db, identifier, ImobError, one, rpc } from "./server";
import { civilDate } from "./schemas";
import { hojeImobiliario } from "./types";

const scopes = {
  proprietario_id: ["proprietarios:financeiro", "proprietario_id"], imovel_id: ["imoveis:financeiro", "imovel_id"],
  reserva_id: ["reservas:financeiro", "reserva_imovel_id"], locacao_id: ["locacoes_imobiliarias:financeiro", "locacao_imovel_id"], venda_id: ["vendas_imobiliarias:financeiro", "venda_imovel_id"],
} as const;
export type FinanceScope = Partial<Record<keyof typeof scopes, number>>;

export function scopeFromUrl(url: URL): FinanceScope {
  const scope: FinanceScope = {};
  for (const key of Object.keys(scopes) as Array<keyof typeof scopes>) {
    const v = url.searchParams.get(key);
    if (v) scope[key] = identifier(v);
  }
  if (url.searchParams.has("contexto_id")) {
    const key = ({ IMOVEL: "imovel_id", PROPRIETARIO: "proprietario_id", RESERVA: "reserva_id", LOCACAO: "locacao_id", VENDA: "venda_id" } as Record<string, keyof typeof scopes>)[String(url.searchParams.get("contexto_tipo")).toUpperCase()];
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

export async function financeReport(scope: FinanceScope, url: URL) {
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
  const saldoAtual = Math.round(items.reduce((s, r) => s + (r.tipo === "BRUTO_RECEBIDO" ? 1 : -1) * Number(r.valor), 0) * 100) / 100;
  const filtered = items.filter((r) => (!inicio || Date.parse(r.data_movimento) >= Date.parse(`${inicio}T00:00:00-03:00`)) && (!fim || Date.parse(r.data_movimento) < Date.parse(`${fim}T00:00:00-03:00`) + 86400000));
  const sum = (tipo: string) => Math.round(filtered.filter((r) => r.tipo === tipo).reduce((s, r) => s + Number(r.valor), 0) * 100) / 100;
  const recebido = sum("BRUTO_RECEBIDO"), receita_administradora = sum("TAXA_ADMIN"), despesas = sum("DESPESA_PROPRIETARIO"), repassado = sum("REPASSE");
  const tx = await scoped(db.from("transacao").select("id,descricao,valor,valorLiquido,valor_baixado,pendente,data,pago_em,imovel_id,proprietario_id,reserva_imovel_id,locacao_imovel_id,venda_imovel_id,imovel_natureza,imovel_competencia,banco_id,metodopagamento").eq("is_deleted", false).not("imovel_id", "is", null).is("baixa_de_transacao_id", null).order("data", { ascending: false }).limit(1000), scope, true);
  if (tx.error) throw tx.error;
  return { items: filtered.map((r) => ({ ...r, data: r.data_movimento })),
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
