import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type OrigemEntrada = "ESTOQUE" | "USOCONSUMO";

export type ItemRevertido = {
  id: number;
  titulo: string;
  referencia: string | null;
  quantidade: number;
  unidade: string | null;
  valorTotal: number;
  estoqueAtual: number | null;
  estoqueDepois: number | null;
  /** O estoque ficaria negativo se a entrada fosse revertida agora. */
  saldoInsuficiente: boolean;
};

export type TransacaoRevertida = {
  id: number;
  descricao: string | null;
  valor: number;
  vencimentoEm: string | null;
  pendente: boolean;
  /** A transação cobre as duas entradas da nota. */
  compartilhada: boolean;
};

export type LadoEntrada = {
  entradaId: number;
  valorTotal: number;
  itens: ItemRevertido[];
};

export type PreviewCancelamento = {
  mista: boolean;
  nota: {
    documentoId: number | null;
    numero: string | null;
    serie: string | null;
    chave: string | null;
    dataEmissao: string | null;
    fornecedor: string | null;
  };
  estoque: LadoEntrada | null;
  usoconsumo: LadoEntrada | null;
  transacoes: TransacaoRevertida[];
  /** Motivos que impedem o cancelamento agora. Vazio = liberado. */
  bloqueios: string[];
};

function numero(valor: unknown) {
  const convertido = Number(valor ?? 0);
  return Number.isFinite(convertido) ? convertido : 0;
}

/**
 * Monta o retrato do que será desfeito ao cancelar uma entrada fiscal. Quando a nota
 * alimentou os dois estoques, os dois lados vêm juntos, porque o cancelamento é
 * obrigatoriamente conjunto.
 */
export async function previewCancelamentoEntrada(
  entradaId: number,
  origem: OrigemEntrada,
): Promise<PreviewCancelamento> {
  const bloqueios: string[] = [];

  const [entradaEstoque, entradaUso] = await Promise.all([
    origem === "ESTOQUE" ? carregarEntradaEstoque(entradaId) : Promise.resolve(null),
    origem === "USOCONSUMO" ? carregarEntradaUso(entradaId) : Promise.resolve(null),
  ]);

  const base = entradaEstoque ?? entradaUso;
  if (!base) throw Object.assign(new Error("Entrada não encontrada."), { statusCode: 404 });
  if (base.status === "CANCELADA") {
    throw Object.assign(new Error("Esta entrada já está cancelada."), { statusCode: 409 });
  }

  const documentoId = base.documentoId;

  // O par só existe quando as duas entradas apontam para o mesmo documento fiscal.
  const par = documentoId ? await carregarPar(documentoId, origem) : null;

  const ladoEstoque = entradaEstoque ?? (origem === "USOCONSUMO" ? par?.estoque ?? null : null);
  const ladoUso = entradaUso ?? (origem === "ESTOQUE" ? par?.usoconsumo ?? null : null);
  const mista = Boolean(ladoEstoque && ladoUso);

  const [itensEstoque, itensUso] = await Promise.all([
    ladoEstoque ? carregarItensEstoque(ladoEstoque.id) : Promise.resolve([]),
    ladoUso ? carregarItensUso(ladoUso.id) : Promise.resolve([]),
  ]);

  const transacoes = await carregarTransacoes(ladoEstoque?.id ?? null, ladoUso?.id ?? null);

  // O cancelamento de uso e consumo recusa transacao ja baixada; o de estoque estorna.
  if (ladoUso && transacoes.some((t) => !t.pendente)) {
    bloqueios.push(
      "Há pagamento já baixado vinculado a esta nota. Estorne a baixa no fluxo de caixa antes de cancelar.",
    );
  }
  for (const item of [...itensEstoque, ...itensUso]) {
    if (item.saldoInsuficiente) {
      bloqueios.push(
        `Saldo insuficiente para reverter "${item.titulo}": restam ${item.estoqueAtual} e a entrada trouxe ${item.quantidade}.`,
      );
    }
  }

  return {
    mista,
    nota: {
      documentoId,
      numero: base.numeroNota,
      serie: base.serieNota,
      chave: base.chave,
      dataEmissao: base.dataEmissao,
      fornecedor: base.fornecedor,
    },
    estoque: ladoEstoque
      ? { entradaId: ladoEstoque.id, valorTotal: numero(ladoEstoque.valorTotal), itens: itensEstoque }
      : null,
    usoconsumo: ladoUso
      ? { entradaId: ladoUso.id, valorTotal: numero(ladoUso.valorTotal), itens: itensUso }
      : null,
    transacoes,
    bloqueios,
  };
}

async function carregarEntradaEstoque(id: number) {
  const { data, error } = await supabaseAdmin
    .from("entrada")
    .select("id,status,valor_total,numero_nota,serie_nota,notachave,data_emissao,fiscal_dfe_documento_id,fornecedor:fornecedorid(nomerazaosocial,nomefantasia)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const fornecedor = data.fornecedor as { nomerazaosocial?: string; nomefantasia?: string } | null;
  return {
    id: data.id as number,
    status: data.status as string,
    valorTotal: data.valor_total as number,
    numeroNota: (data.numero_nota as string) ?? null,
    serieNota: (data.serie_nota as string) ?? null,
    chave: (data.notachave as string) ?? null,
    dataEmissao: (data.data_emissao as string) ?? null,
    documentoId: (data.fiscal_dfe_documento_id as number) ?? null,
    fornecedor: fornecedor?.nomefantasia ?? fornecedor?.nomerazaosocial ?? null,
  };
}

async function carregarEntradaUso(id: number) {
  const { data, error } = await supabaseAdmin
    .from("usoconsumo_entrada")
    .select("id,status,valor_total,numero_nota,serie_nota,chave_nfe,data_emissao,documento_fiscal_recebido_id,fornecedor:fornecedor_id(nomerazaosocial,nomefantasia)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const fornecedor = data.fornecedor as { nomerazaosocial?: string; nomefantasia?: string } | null;
  return {
    id: data.id as number,
    status: data.status as string,
    valorTotal: data.valor_total as number,
    numeroNota: (data.numero_nota as string) ?? null,
    serieNota: (data.serie_nota as string) ?? null,
    chave: (data.chave_nfe as string) ?? null,
    dataEmissao: (data.data_emissao as string) ?? null,
    documentoId: (data.documento_fiscal_recebido_id as number) ?? null,
    fornecedor: fornecedor?.nomefantasia ?? fornecedor?.nomerazaosocial ?? null,
  };
}

async function carregarPar(documentoId: number, origem: OrigemEntrada) {
  if (origem === "ESTOQUE") {
    const { data, error } = await supabaseAdmin
      .from("usoconsumo_entrada")
      .select("id,valor_total")
      .eq("documento_fiscal_recebido_id", documentoId)
      .neq("status", "CANCELADA")
      .maybeSingle();
    if (error) throw error;
    return data ? { estoque: null, usoconsumo: { id: data.id as number, valorTotal: data.valor_total as number } } : null;
  }
  const { data, error } = await supabaseAdmin
    .from("entrada")
    .select("id,valor_total")
    .eq("fiscal_dfe_documento_id", documentoId)
    .neq("status", "CANCELADA")
    .maybeSingle();
  if (error) throw error;
  return data ? { estoque: { id: data.id as number, valorTotal: data.valor_total as number }, usoconsumo: null } : null;
}

async function carregarItensEstoque(entradaId: number): Promise<ItemRevertido[]> {
  const { data, error } = await supabaseAdmin
    .from("entradaitens")
    .select("id,quantidade,unidade,valor_total,titulo,referencia,produto:produto_id(id,descricao,estoque)")
    .eq("entrada_id", entradaId);
  if (error) throw error;
  return (data ?? []).map((linha) => {
    const produto = linha.produto as { descricao?: string; estoque?: number } | null;
    const quantidade = numero(linha.quantidade);
    const estoqueAtual = produto?.estoque ?? null;
    const estoqueDepois = estoqueAtual === null ? null : estoqueAtual - quantidade;
    return {
      id: linha.id as number,
      titulo: (linha.titulo as string) || produto?.descricao || `Produto #${linha.id}`,
      referencia: (linha.referencia as string) ?? null,
      quantidade,
      unidade: (linha.unidade as string) ?? null,
      valorTotal: numero(linha.valor_total),
      estoqueAtual,
      estoqueDepois,
      saldoInsuficiente: estoqueDepois !== null && estoqueDepois < 0,
    };
  });
}

async function carregarItensUso(entradaId: number): Promise<ItemRevertido[]> {
  const { data, error } = await supabaseAdmin
    .from("usoconsumo_entrada_item")
    .select("id,quantidade,unidade,valor_total,titulo,referencia,item:item_id(id,titulo,estoque)")
    .eq("entrada_id", entradaId);
  if (error) throw error;
  return (data ?? []).map((linha) => {
    const item = linha.item as { titulo?: string; estoque?: number } | null;
    const quantidade = numero(linha.quantidade);
    const estoqueAtual = item?.estoque ?? null;
    const estoqueDepois = estoqueAtual === null ? null : estoqueAtual - quantidade;
    return {
      id: linha.id as number,
      titulo: (linha.titulo as string) || item?.titulo || `Item #${linha.id}`,
      referencia: (linha.referencia as string) ?? null,
      quantidade,
      unidade: (linha.unidade as string) ?? null,
      valorTotal: numero(linha.valor_total),
      estoqueAtual,
      estoqueDepois,
      saldoInsuficiente: estoqueDepois !== null && estoqueDepois < 0,
    };
  });
}

async function carregarTransacoes(
  entradaId: number | null,
  usoconsumoEntradaId: number | null,
): Promise<TransacaoRevertida[]> {
  const filtros: string[] = [];
  if (entradaId) filtros.push(`entrada_id.eq.${entradaId}`);
  if (usoconsumoEntradaId) filtros.push(`usoconsumo_entrada_id.eq.${usoconsumoEntradaId}`);
  if (!filtros.length) return [];

  const { data, error } = await supabaseAdmin
    .from("transacao")
    .select("id,descricao,valor,vencimento_em,pendente,entrada_id,usoconsumo_entrada_id")
    .or(filtros.join(","))
    .eq("is_deleted", false)
    .is("estorno_transacao_id", null)
    .order("vencimento_em", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((linha) => ({
    id: linha.id as number,
    descricao: (linha.descricao as string) ?? null,
    valor: numero(linha.valor),
    vencimentoEm: (linha.vencimento_em as string) ?? null,
    pendente: Boolean(linha.pendente),
    compartilhada: Boolean(linha.entrada_id) && Boolean(linha.usoconsumo_entrada_id),
  }));
}
