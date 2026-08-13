import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Fatias de pagamento múltiplo por documento.
 *
 * Num pagamento múltiplo a transação não aponta para OS nem para venda: ela é o
 * dinheiro, e cobre vários documentos ao mesmo tempo. O elo — e quanto coube a
 * cada um — vive em `pagamento_multiplo_rateio`.
 *
 * Quem soma "quanto este documento recebeu" lendo só `transacao.ordemservicoid`
 * ou `transacao.vendaid` enxerga zero nesses casos. Isso já apareceu como bug em
 * três telas diferentes (painel da OS, lista de vendas, lista de OS), sempre
 * pelo mesmo motivo, e cada uma foi corrigida no seu canto. Este módulo existe
 * para que a quarta não precise ser descoberta em produção.
 */
export type TipoDocumentoRateio = "OS" | "VENDA";

export type FatiaRateada = {
  documentoId: number;
  transacaoId: number;
  /** O que coube a ESTE documento — não o valor cheio do recebimento. */
  valor: number;
  descricao: string | null;
  data: string | null;
  metodopagamento: string | null;
  categoria: string | null;
  pendente: boolean;
  pagamentoMultiploId: number;
};

/**
 * Fatias agrupadas por documento. Documento sem pagamento em grupo não aparece
 * no mapa — quem chama deve tratar a ausência como lista vazia.
 */
export async function carregarFatiasRateadas(
  tipo: TipoDocumentoRateio,
  ids: Array<number | string>,
): Promise<Map<number, FatiaRateada[]>> {
  const alvos = [
    ...new Set(ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)),
  ];
  if (alvos.length === 0) return new Map();

  const { data, error } = await supabaseAdmin
    .from("pagamento_multiplo_rateio")
    .select(
      "documento_id, valor, pagamento_multiplo_id, transacao:transacao_id ( id, descricao, data, metodopagamento, categoria, pendente, is_deleted )",
    )
    .eq("tipo_documento", tipo)
    .in("documento_id", alvos);

  if (error) throw error;

  const porDocumento = new Map<number, FatiaRateada[]>();

  for (const linha of (data ?? []) as any[]) {
    const transacao = linha.transacao;
    // Transação excluída não abate mais nada; o rateio dela fica no banco só
    // como histórico do que aquele pagamento cobriu.
    if (!transacao || transacao.is_deleted) continue;

    const documentoId = Number(linha.documento_id);
    const fatia: FatiaRateada = {
      documentoId,
      transacaoId: Number(transacao.id),
      valor: Number(linha.valor ?? 0),
      descricao: transacao.descricao ?? null,
      data: transacao.data ?? null,
      metodopagamento: transacao.metodopagamento ?? null,
      categoria: transacao.categoria ?? null,
      pendente: transacao.pendente === true,
      pagamentoMultiploId: Number(linha.pagamento_multiplo_id),
    };

    const lista = porDocumento.get(documentoId);
    if (lista) lista.push(fatia);
    else porDocumento.set(documentoId, [fatia]);
  }

  return porDocumento;
}

/**
 * Fatia no formato de uma linha de `transacao`, que é o que a maioria dos
 * somadores espera receber. O valor de face é a própria fatia: o acréscimo
 * financeiro pertence à transação inteira, não ao pedaço de um documento.
 */
export function fatiaComoTransacao(fatia: FatiaRateada) {
  return {
    id: fatia.transacaoId,
    descricao: fatia.descricao ?? "",
    valor: fatia.valor,
    valorLiquido: fatia.valor,
    valor_acrescimos: 0,
    valor_descontos: 0,
    data: fatia.data,
    metodopagamento: fatia.metodopagamento,
    metodoPagamento: fatia.metodopagamento,
    categoria: fatia.categoria,
    tipo: "RECEITA" as const,
    pendente: fatia.pendente,
    is_deleted: false,
    evento_financeiro_id: null,
    baixado_por: null,
    baixadoPor: null,
    pagamento_multiplo_id: fatia.pagamentoMultiploId,
    /** Marca para a tela distinguir a fatia do recebimento inteiro. */
    rateado: true,
  };
}
