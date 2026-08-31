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
  custoTotalEstoque: number;
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
): Promise<PersonalizacaoFiscal | null> {
  const coluna = inventory === "produto" ? "entrada_id" : "usoconsumo_entrada_id";
  const { data, error } = await supabaseAdmin
    .from("entrada_fiscal_personalizada")
    .select("destino,custo_total_estoque,itens_originais,created_at")
    .eq(coluna, entryId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const itens = Array.isArray(data.itens_originais) ? data.itens_originais : [];
  return {
    destino: data.destino as PersonalizacaoFiscal["destino"],
    custoTotalEstoque: numero(data.custo_total_estoque),
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

