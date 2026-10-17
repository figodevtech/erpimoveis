import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ajustesValoresEntradaSchema, type AjustesValoresEntrada, type HistoricoValoresEntrada,
  type ValoresCompraEntrada } from "@/lib/estoque/entrada-valores";
import { paraCentavos, paraReais } from "@/lib/financeiro/rateio";
import { lerNFeDoXml, lerTotaisDaNota } from "@/lib/nfe/totais-nfe";

export type ContextoValoresEntrada = {
  status: string;
  documento_id: number | null;
  entrada_id: number | null;
  usoconsumo_entrada_id: number | null;
  entrada_ids: number[];
  usoconsumo_entrada_ids: number[];
  valor_total: number;
  valor_total_original: number;
  valor_total_produtos: number;
  valor_total_usoconsumo: number;
  versao_financeiro: string;
};

export function erroValoresEntrada(error: { code?: string; message?: string; statusCode?: number }) {
  return {
    status: error.statusCode ?? (error.code === "P0002" ? 404
      : ["40001", "55000"].includes(error.code ?? "") ? 409
        : ["22023", "23514", "22P02", "P0003"].includes(error.code ?? "") ? 400 : 500),
    message: error.message ?? "Não foi possível ajustar os valores da entrada.",
  };
}

export function lerAjustesValoresEntrada(value: unknown): AjustesValoresEntrada | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = ajustesValoresEntradaSchema.safeParse(value);
  if (!parsed.success) throw Object.assign(
    new Error(parsed.error.issues.map((issue) => issue.message).join(" ")), { statusCode: 400 });
  return parsed.data;
}

/** Sem ajuste mantém exatamente a RPC e o contrato dos clientes existentes. */
export async function registrarEntradaComValores(
  rpc: string, modalidade: "PRODUTO" | "USOCONSUMO" | "MISTA" | "PERSONALIZADA" | "HIBRIDA",
  parametros: Record<string, unknown>, ajustes: AjustesValoresEntrada | undefined, createdBy?: string | null,
) {
  if (!ajustes) return supabaseAdmin.rpc(rpc, parametros);
  const { p_transacoes = [], ...base } = parametros;
  return supabaseAdmin.rpc("registrar_entrada_com_valores", {
    p_modalidade: modalidade, p_parametros: base, p_ajustes: ajustes,
    p_transacoes, p_created_by: createdBy ?? null,
  });
}

export async function carregarContextoValoresEntrada(inventory: "produto" | "usoconsumo", id: number) {
  const { data, error } = await supabaseAdmin.rpc("contexto_valores_entrada", { p_inventory: inventory, p_id: id });
  if (error) throw error;
  return data as ContextoValoresEntrada;
}

export async function transacoesDoContexto(contexto: ContextoValoresEntrada, somenteAtivas = false) {
  const filtros = [
    contexto.entrada_ids.length ? `entrada_id.in.(${contexto.entrada_ids.join(",")})` : null,
    contexto.usoconsumo_entrada_ids.length ? `usoconsumo_entrada_id.in.(${contexto.usoconsumo_entrada_ids.join(",")})` : null,
  ].filter(Boolean);
  if (!filtros.length) return [];
  let query = supabaseAdmin.from("transacao")
    .select("id,descricao,valor,data,vencimento_em,pendente,is_deleted,estorno_transacao_id")
    .or(filtros.join(",")).order("id");
  if (somenteAtivas) query = query.eq("is_deleted", false);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function carregarValoresCompra(inventory: "produto" | "usoconsumo", id: number): Promise<ValoresCompraEntrada> {
  const contexto = await carregarContextoValoresEntrada(inventory, id);
  const [auditoria, transacoes, documento] = await Promise.all([
    supabaseAdmin.from("entrada_valor_ajuste").select("id,created_at,created_by,motivo,valor_anterior,valor_novo,itens")
      .eq(inventory === "produto" ? "entrada_id" : "usoconsumo_entrada_id", id).order("id", { ascending: false }).limit(100),
    transacoesDoContexto(contexto, true),
    contexto.documento_id ? supabaseAdmin.from("fiscal_dfe_documento").select("xml").eq("id", contexto.documento_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (auditoria.error) throw auditoria.error;
  if (documento.error) throw documento.error;
  let valorNota = Number(contexto.valor_total_original);
  if (documento.data?.xml) {
    try {
      const { infNFe } = lerNFeDoXml(documento.data.xml);
      if (infNFe) valorNota = lerTotaisDaNota(infNFe).totalNota;
    } catch {
      // Entradas antigas sem XML completo continuam consultáveis pela referência persistida.
    }
  }
  const autores = [...new Set((auditoria.data ?? []).map((row) => String(row.created_by)))];
  const nomes = new Map<string, string>();
  if (autores.length) {
    const { data, error } = await supabaseAdmin.from("usuario").select("id,nome").in("id", autores);
    if (error) throw error;
    for (const autor of data ?? []) nomes.set(String(autor.id), autor.nome);
  }
  const totalFinanceiro = paraReais(transacoes.reduce((sum, tx) => sum + paraCentavos(tx.valor), 0));
  return {
    valorNota, totalCompra: Number(contexto.valor_total), totalFinanceiro,
    financeiroPreservado: transacoes.length > 0 && paraCentavos(totalFinanceiro) !== paraCentavos(contexto.valor_total),
    versaoFinanceiro: contexto.versao_financeiro,
    historico: (auditoria.data ?? []).map((row) => ({ ...row,
      autor_nome: nomes.get(String(row.created_by)) ?? null })) as HistoricoValoresEntrada[],
  };
}
