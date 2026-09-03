import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Leitura dos consumos de estoque de uma OS, separados pelo que acontece com
 * eles quando a ordem e cancelada.
 *
 * A regra de corte e a MESMA da RPC `estornar_consumos_os`: volta ao estoque o
 * consumo cuja saida ainda esta `CONFIRMADA` e cujo evento nao tem dinheiro real
 * amarrado. Duas copias de uma regra dessas divergem em silencio, entao o
 * comentario aqui e o comentario la apontam um para o outro — se uma mudar, a
 * outra tem que mudar junto (supabase/migrations/20260903120000_consumo_de_produto_na_os.sql).
 *
 * Serve ao painel de impacto que o dialogo de cancelar OS mostra ANTES de
 * cancelar: o operador precisa saber o que volta e o que fica.
 *
 * Nem todo evento `CONSUMO` entra aqui. O lancamento avulso de consumo (a fita
 * comprada na hora, que nao passou pelo estoque) tem a mesma origem, mas nao
 * tem documento de saida — e sem saida nao ha saldo para devolver. Por isso o
 * corte e a presenca do documento, nao a origem do evento.
 */

export type ConsumoDaOs = {
  eventoId: number;
  descricao: string;
  detalhe: string | null;
  valor: number;
  escopo: "PRODUTO" | "USOCONSUMO" | "GERAL";
  itemTitulo: string | null;
  quantidade: number;
  unidade: string | null;
  saidaId: number | null;
  saidaStatus: string | null;
  /** Por que este consumo NAO volta ao estoque. `null` quando ele volta. */
  motivoRetencao: string | null;
};

export type ConsumosDaOs = {
  /** O que o cancelamento da OS devolve ao estoque. */
  estornaveis: ConsumoDaOs[];
  /** O que fica fora do estoque por ter transacao vinculada. */
  retidos: ConsumoDaOs[];
};

const VAZIO: ConsumosDaOs = { estornaveis: [], retidos: [] };

function texto(valor: unknown) {
  const limpo = String(valor ?? "").trim();
  return limpo || null;
}

export async function listarConsumosDaOs(osId: number): Promise<ConsumosDaOs> {
  const { data, error } = await supabaseAdmin
    .from("eventos_financeiros")
    .select(
      "id, descricao, detalhe, valor, status, transacaoid, lancamento_id, quantidade_snapshot, dados_snapshot, consumo_saida_id, consumo_usoconsumo_saida_id",
    )
    .eq("ordemservicoid", osId)
    .eq("origem", "CONSUMO")
    .neq("status", "CANCELADO")
    .order("id", { ascending: true });
  if (error) throw error;

  // O documento e o que faz do evento um consumo DE ESTOQUE. Sem ele nao ha
  // nada a devolver, e listar assim mesmo prometeria ao operador um estorno
  // que o cancelamento nao faz.
  const comDocumento = (data ?? []).filter(
    (evento: any) => evento.consumo_saida_id != null || evento.consumo_usoconsumo_saida_id != null,
  );
  if (comDocumento.length === 0) return VAZIO;

  // Duas consultas simples em vez de um embed: o embed dependeria do nome que o
  // Postgres gerou para a FK, e um rename silencioso quebraria a leitura.
  const idsProduto = comDocumento.map((e: any) => e.consumo_saida_id).filter(Boolean);
  const idsSimples = comDocumento.map((e: any) => e.consumo_usoconsumo_saida_id).filter(Boolean);

  const [saidasProduto, saidasSimples] = await Promise.all([
    idsProduto.length
      ? supabaseAdmin.from("estoque_saida").select("id, status").in("id", idsProduto)
      : Promise.resolve({ data: [], error: null }),
    idsSimples.length
      ? supabaseAdmin.from("usoconsumo_saida").select("id, status").in("id", idsSimples)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (saidasProduto.error) throw saidasProduto.error;
  if (saidasSimples.error) throw saidasSimples.error;

  const statusPorSaida = new Map<string, string>();
  for (const saida of saidasProduto.data ?? []) {
    statusPorSaida.set(`PRODUTO:${saida.id}`, String(saida.status));
  }
  for (const saida of saidasSimples.data ?? []) {
    statusPorSaida.set(`SIMPLES:${saida.id}`, String(saida.status));
  }

  const resultado: ConsumosDaOs = { estornaveis: [], retidos: [] };

  for (const evento of comDocumento as any[]) {
    const snapshot = (evento.dados_snapshot ?? {}) as Record<string, unknown>;
    const daVenda = evento.consumo_saida_id != null;
    const saidaId = daVenda ? Number(evento.consumo_saida_id) : evento.consumo_usoconsumo_saida_id != null ? Number(evento.consumo_usoconsumo_saida_id) : null;
    const saidaStatus = saidaId == null
      ? null
      : statusPorSaida.get(`${daVenda ? "PRODUTO" : "SIMPLES"}:${saidaId}`) ?? null;

    const temDinheiro =
      evento.status === "CONVERTIDO" || evento.transacaoid != null || evento.lancamento_id != null;

    const motivoRetencao = temDinheiro
      ? "Já lançado no financeiro — o item continua fora do estoque."
      : saidaStatus !== null && saidaStatus !== "CONFIRMADA"
        ? "A saída já foi cancelada."
        : null;

    const linha: ConsumoDaOs = {
      eventoId: Number(evento.id),
      descricao: String(evento.descricao ?? "Consumo de estoque"),
      detalhe: texto(evento.detalhe),
      valor: Number(evento.valor ?? 0),
      escopo: (texto(snapshot.escopo) as ConsumoDaOs["escopo"]) ?? (daVenda ? "PRODUTO" : "USOCONSUMO"),
      itemTitulo: texto(snapshot.item_titulo),
      quantidade: Number(evento.quantidade_snapshot ?? 0),
      unidade: texto(snapshot.unidade),
      saidaId,
      saidaStatus,
      motivoRetencao,
    };

    if (motivoRetencao) resultado.retidos.push(linha);
    else resultado.estornaveis.push(linha);
  }

  return resultado;
}
