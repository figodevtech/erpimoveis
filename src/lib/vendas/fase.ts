/**
 * Fase da venda no histórico: aberta ou finalizada.
 *
 * O status da venda é financeiro — FINALIZADA quer dizer pagamento quitado, e o
 * banco o recalcula pelos lançamentos (`recalcular_status_financeiro_venda`).
 * A fase responde outra pergunta: ainda falta fazer algo com esta venda? No
 * balcão as duas coincidem. Nos marketplaces o pedido chega pago e ainda falta
 * entregar — e, no Mercado Livre e na Shopee, faturar (NF-e). Mudar o status
 * para esperar a entrega travaria a emissão da nota, que exige FINALIZADA, e
 * jogaria o pedido na fila de cobrança.
 *
 * Cancelada conta como finalizada, como nas abas de OS.
 */

export const FASES_VENDA = [
  ["ABERTAS", "Abertas"],
  ["FINALIZADAS", "Finalizadas"],
] as const;

export type FaseVenda = (typeof FASES_VENDA)[number][0];

export type PendenciaFinalizacao = "NOTA" | "ENTREGA";

/** Canais em que o pagamento não encerra a venda: falta a entrega. */
export const CANAIS_FINALIZAM_NA_ENTREGA = ["MERCADO_LIVRE", "SHOPEE", "ONLINE"] as const;

/** Dos canais com entrega, os que também exigem NF-e. O site vende sem nota. */
export const CANAIS_EXIGEM_NOTA = ["MERCADO_LIVRE", "SHOPEE"] as const;

const doCanal = (canais: readonly string[], canal: string) => canais.includes(canal);

const QUITADAS = ["FINALIZADA", "PAGO"];
const CANCELADAS = ["CANCELADA", "CANCELADO"];

export function faseValida(valor: unknown): FaseVenda | null {
  const fase = String(valor ?? "").trim().toUpperCase();
  return FASES_VENDA.some(([chave]) => chave === fase) ? (fase as FaseVenda) : null;
}

export type SituacaoVenda = {
  status: string | null | undefined;
  canal: string | null | undefined;
  statusEntrega: string | null | undefined;
  /** NF-e autorizada no ERP (direta ou agrupada) ou chave informada à mão. */
  faturada: boolean;
};

/** O que falta para uma venda paga ser finalizada; vazio fora dos canais com entrega. */
export function pendenciasParaFinalizar(venda: SituacaoVenda): PendenciaFinalizacao[] {
  const status = String(venda.status ?? "").toUpperCase();
  const canal = String(venda.canal ?? "").toUpperCase();
  if (!QUITADAS.includes(status)) return [];
  if (!doCanal(CANAIS_FINALIZAM_NA_ENTREGA, canal)) return [];
  const pendencias: PendenciaFinalizacao[] = [];
  if (doCanal(CANAIS_EXIGEM_NOTA, canal) && !venda.faturada) pendencias.push("NOTA");
  if (String(venda.statusEntrega ?? "").toUpperCase() !== "ENTREGUE") pendencias.push("ENTREGA");
  return pendencias;
}

export function faseDaVenda(venda: SituacaoVenda): FaseVenda {
  const status = String(venda.status ?? "").toUpperCase();
  if (CANCELADAS.includes(status)) return "FINALIZADAS";
  if (!QUITADAS.includes(status)) return "ABERTAS";
  return pendenciasParaFinalizar(venda).length > 0 ? "ABERTAS" : "FINALIZADAS";
}

/**
 * Relações auxiliares que dizem se a venda foi faturada. O prefixo `filtro_`
 * faz a rota de vendas apagá-las da resposta depois de ler. A chave manual
 * (`nfe_chave_acesso`, da nota emitida fora do ERP) já vem nas duas seleções.
 */
const NOTA = "filtro_fase_nota";
const NOTA_GRUPO = "filtro_fase_grupo";

/**
 * Mesma regra de `faseDaVenda`, em sintaxe PostgREST, para filtrar antes da
 * paginação. As duas expressões são complementares: toda venda cai em uma só.
 */
export function planoFaseVendas(fase: FaseVenda) {
  const lista = (valores: readonly string[]) => `(${valores.join(",")})`;
  const quitada = `status.in.${lista(QUITADAS)}`;
  const comEntrega = lista(CANAIS_FINALIZAM_NA_ENTREGA);
  const comNota = lista(CANAIS_EXIGEM_NOTA);
  const soEntrega = CANAIS_FINALIZAM_NA_ENTREGA.filter((canal) => !doCanal(CANAIS_EXIGEM_NOTA, canal));
  const alternativas = fase === "FINALIZADAS"
    ? [
        `status.in.${lista(CANCELADAS)}`,
        `and(${quitada},canal.not.in.${comEntrega})`,
        // `in.()` vazio é erro de sintaxe no PostgREST.
        ...(soEntrega.length ? [`and(${quitada},canal.in.${lista(soEntrega)},status_entrega.eq.ENTREGUE)`] : []),
        `and(${quitada},canal.in.${comNota},status_entrega.eq.ENTREGUE,or(nfe_chave_acesso.not.is.null,${NOTA}.not.is.null,${NOTA_GRUPO}.not.is.null))`,
      ]
    : [
        `status.not.in.${lista([...QUITADAS, ...CANCELADAS])}`,
        `and(${quitada},canal.in.${comEntrega},or(status_entrega.is.null,status_entrega.neq.ENTREGUE))`,
        `and(${quitada},canal.in.${comNota},nfe_chave_acesso.is.null,${NOTA}.is.null,${NOTA_GRUPO}.is.null)`,
      ];

  return {
    select: [
      `${NOTA}:nfe!nfe_vendaid_fkey(id)`,
      `${NOTA_GRUPO}:nfe_origem_vinculo!venda_id(nota:nfe_id!inner(id))`,
    ],
    filtros: [
      { relacao: NOTA, expressao: "status.eq.AUTORIZADA" },
      { relacao: NOTA_GRUPO, expressao: "ativo.is.true" },
      { relacao: `${NOTA_GRUPO}.nota`, expressao: "status.eq.AUTORIZADA" },
    ],
    expressao: alternativas.join(","),
  };
}

/** Lê das relações de `planoFaseVendas` se a venda já foi faturada. */
export function faturadaNaResposta(item: Record<string, unknown>) {
  const temLinha = (valor: unknown) => Array.isArray(valor) && valor.length > 0;
  return item.nfe_chave_acesso != null || temLinha(item[NOTA]) || temLinha(item[NOTA_GRUPO]);
}
