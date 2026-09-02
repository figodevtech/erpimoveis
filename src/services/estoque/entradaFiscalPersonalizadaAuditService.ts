import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type ItemOriginalEntradaPersonalizada = {
  numeroItem: number;
  codigo: string | null;
  descricao: string | null;
  unidade: string | null;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  custoEstoque: number;
};

export type PersonalizacaoFiscal = {
  destino: "ESTOQUE" | "USOCONSUMO" | "GERAL";
  modalidade: "INTEGRAL" | "HIBRIDA";
  custoTotalEstoque: number;
  custoUnitario: number | null;
  quantidadePersonalizada: number | null;
  valorFiscalDocumento: number | null;
  itemDestino: {
    id: number | null;
    titulo: string | null;
    referencia: string | null;
    unidade: string | null;
  } | null;
  createdAt: string;
  itensOriginais: ItemOriginalEntradaPersonalizada[];
};

function numero(value: unknown) {
  const convertido = Number(value ?? 0);
  return Number.isFinite(convertido) ? convertido : 0;
}

function texto(value: unknown) {
  const normalizado = String(value ?? "").trim();
  return normalizado || null;
}

export async function carregarPersonalizacaoFiscal(
  inventory: "produto" | "usoconsumo",
  entryId: number,
  contexto?: { documentoId?: number | null; entradaCreatedAt?: string | null },
): Promise<PersonalizacaoFiscal | null> {
  const coluna = inventory === "produto" ? "entrada_id" : "usoconsumo_entrada_id";
  const campos = [
    "destino",
    "modalidade",
    "produto_id",
    "usoconsumo_item_id",
    "quantidade_personalizada",
    "custo_unitario",
    "valor_fiscal_documento",
    "item_destino_snapshot",
    "custo_total_estoque",
    "itens_originais",
    "created_at",
  ].join(",");
  const direto = await supabaseAdmin
    .from("entrada_fiscal_personalizada")
    .select(campos)
    .eq(coluna, entryId)
    .maybeSingle();
  if (direto.error) throw direto.error;

  let data = direto.data as any;
  if (!data && contexto?.documentoId) {
    const relacionado = await supabaseAdmin
      .from("entrada_fiscal_personalizada")
      .select(campos)
      .eq("documento_id", contexto.documentoId)
      .order("created_at", { ascending: false });
    if (relacionado.error) throw relacionado.error;

    const candidatos = (relacionado.data ?? []) as any[];
    const referencia = contexto.entradaCreatedAt
      ? new Date(contexto.entradaCreatedAt).getTime()
      : Number.NaN;
    data = Number.isFinite(referencia)
      ? [...candidatos].sort(
          (a, b) =>
            Math.abs(new Date(a.created_at).getTime() - referencia) -
            Math.abs(new Date(b.created_at).getTime() - referencia),
        )[0]
      : candidatos[0];
  }
  if (!data) return null;

  const itens = Array.isArray(data.itens_originais) ? data.itens_originais : [];
  const snapshot =
    data.item_destino_snapshot &&
    typeof data.item_destino_snapshot === "object" &&
    !Array.isArray(data.item_destino_snapshot)
      ? data.item_destino_snapshot
      : null;
  return {
    destino: data.destino as PersonalizacaoFiscal["destino"],
    modalidade: data.modalidade === "HIBRIDA" ? "HIBRIDA" : "INTEGRAL",
    custoTotalEstoque: numero(data.custo_total_estoque),
    custoUnitario:
      data.custo_unitario == null ? null : numero(data.custo_unitario),
    quantidadePersonalizada:
      data.quantidade_personalizada == null
        ? null
        : numero(data.quantidade_personalizada),
    valorFiscalDocumento:
      data.valor_fiscal_documento == null
        ? null
        : numero(data.valor_fiscal_documento),
    itemDestino: snapshot
      ? {
          id:
            numero(snapshot.id) ||
            numero(data.produto_id) ||
            numero(data.usoconsumo_item_id) ||
            null,
          titulo: texto(snapshot.titulo),
          referencia: texto(snapshot.referencia),
          unidade: texto(snapshot.unidade),
        }
      : null,
    createdAt: String(data.created_at),
    itensOriginais: itens.map((item: any) => ({
      numeroItem: numero(item?.numero_item),
      codigo: texto(item?.codigo),
      descricao: texto(item?.descricao),
      unidade: texto(item?.unidade),
      quantidade: numero(item?.quantidade),
      valorUnitario: numero(item?.valor_unitario),
      valorTotal: numero(item?.valor_total),
      custoEstoque: numero(item?.custo_estoque),
    })),
  };
}

