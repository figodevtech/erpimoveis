import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { dataDoCalendario } from "@/lib/data-calendario";
import { entradaUsoConsumoSchema, zodMessage } from "@/lib/usoconsumo/schemas";
import { normalizarUnidadeMedidaEntrada } from "./entradaService";

function positiveInt(value: unknown, field: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${field}: informe um número inteiro maior que zero.`);
  return number;
}

function nonNegative(value: unknown, field: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${field}: informe um valor válido.`);
  return number;
}

function nullableId(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return null;
  return positiveInt(value, field);
}

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * Registra uma NF-e cujos itens foram divididos entre o estoque de revenda e o de
 * uso e consumo. As duas entradas nascem sem lançamento financeiro; o pagamento é
 * gravado uma única vez pela RPC e aponta para as duas ao mesmo tempo.
 */
export async function registrarEntradaFiscalMista(body: any, createdBy?: string | null) {
  const itensProdutoRaw = Array.isArray(body?.itensProduto) ? body.itensProduto : [];
  const itensUsoRaw = Array.isArray(body?.itensUsoConsumo) ? body.itensUsoConsumo : [];

  if (!itensProdutoRaw.length || !itensUsoRaw.length) {
    throw new Error("A entrada mista exige ao menos um item de estoque e um item de uso e consumo.");
  }

  const chave = digits(body?.notaChave ?? body?.chave_nfe);
  if (chave.length !== 44) throw new Error("A entrada fiscal exige uma chave de acesso válida com 44 dígitos.");

  const fornecedorId = positiveInt(body?.fornecedorId ?? body?.fornecedor_id, "Fornecedor");
  const documentoId = nullableId(
    body?.documentoFiscalRecebidoId ?? body?.documento_fiscal_recebido_id,
    "Documento fiscal recebido",
  );

  const itensProduto = itensProdutoRaw.map((item: any, index: number) => ({
    produto_id: positiveInt(item.produtoId ?? item.produto_id, `Produto ${index + 1}`),
    quantidade: positiveInt(item.quantidade, `Quantidade do produto ${index + 1}`),
    valor_unitario_compra: nonNegative(
      item.valorUnitario ?? item.valor_unitario_compra,
      `Valor unitário de compra do produto ${index + 1}`,
    ),
    valor_desconto: nonNegative(item.valorDesconto ?? 0, `Desconto do produto ${index + 1}`),
    valor_frete: nonNegative(item.valorFrete ?? 0, `Frete do produto ${index + 1}`),
    outras_despesas: nonNegative(item.outrasDespesas ?? 0, `Outras despesas do produto ${index + 1}`),
    unidade: normalizarUnidadeMedidaEntrada(item.unidade),
    ncm: text(item.ncm),
    cfop: text(item.cfop),
    referencia: text(item.referencia),
    titulo: text(item.titulo),
    numero_item_fiscal: positiveInt(
      item.numeroItemFiscal ?? item.numero_item_fiscal,
      `Número fiscal do produto ${index + 1}`,
    ),
  }));

  const entradaProduto = {
    fornecedorid: fornecedorId,
    fiscal: true,
    notachave: chave,
    tipo: "COMPRA_FORNECEDOR",
    origem: "NFE_TERCEIRO",
    numero_nota: text(body?.numeroNota),
    serie_nota: text(body?.serie ?? body?.serieNota),
    data_emissao: text(body?.dataEmissao),
    fiscal_dfe_documento_id: documentoId,
    created_by: createdBy ?? null,
  };

  // A metade de uso e consumo passa pelo mesmo schema da entrada avulsa, para herdar
  // as validações já existentes (chave, fornecedor, número fiscal por item).
  const parsedUso = entradaUsoConsumoSchema.safeParse({
    fornecedor_id: fornecedorId,
    fiscal: true,
    chave_nfe: chave,
    numero_nota: text(body?.numeroNota) ?? undefined,
    serie_nota: text(body?.serie ?? body?.serieNota) ?? undefined,
    data_emissao: text(body?.dataEmissao) ?? undefined,
    tipo: "COMPRA_FORNECEDOR",
    origem: "NFE_TERCEIRO",
    documento_fiscal_recebido_id: documentoId ?? undefined,
    itens: itensUsoRaw,
    transacoes: [],
  });
  if (!parsedUso.success) throw Object.assign(new Error(zodMessage(parsedUso.error)), { statusCode: 400 });
  // As transacoes sao descartadas aqui de proposito: o pagamento e unico e a RPC mista
  // o grava uma vez so, apontando para as duas entradas.
  const { itens: itensUsoConsumo, transacoes: transacoesDescartadas, ...entradaUsoConsumo } = parsedUso.data;
  void transacoesDescartadas;

  const transacoes = montarTransacoes(body);

  const { data, error } = await supabaseAdmin.rpc("registrar_entrada_fiscal_mista", {
    p_entrada_produto: entradaProduto,
    p_itens_produto: itensProduto,
    p_entrada_usoconsumo: { ...entradaUsoConsumo, created_by: createdBy ?? null },
    p_itens_usoconsumo: itensUsoConsumo,
    p_transacoes: transacoes,
  });
  if (error) throw error;
  return data as { entrada_id: number; usoconsumo_entrada_id: number; valor_total: number };
}

function montarTransacoes(body: any) {
  if (!body?.isPagamentoFuturo) return [];

  const parcelas = Array.isArray(body?.parcelas) ? body.parcelas : [];
  if (!parcelas.length) throw new Error("Informe ao menos uma parcela para o lançamento futuro.");

  const base = {
    metodopagamento: text(body?.metodoPagamento),
    categoria: text(body?.categoria) ?? "NÃO RELACIONADO",
    categoria_id: nullableId(body?.categoriaId, "Categoria"),
    banco_id: nullableId(body?.bancoId, "Banco"),
    plano_de_conta_id: nullableId(body?.planoContaId, "Plano de conta"),
    plano_de_conta: text(body?.planoConta),
    centro_custo_id: nullableId(body?.centroCustoId, "Centro de custo"),
    centro_custo: text(body?.centroCusto),
    nomepagador: text(body?.nomePagador) ?? "Fornecedor",
    cpfcnpjpagador: digits(body?.cpfCnpjPagador) || "NÃO INFORMADO",
  };
  const descricao = text(body?.descricaoTransacao) ?? "Compra de mercadorias";

  return parcelas.map((parcela: any, index: number) => {
    const vencimento = text(parcela.dataVencimento ?? parcela.vencimento_em);
    if (!vencimento) throw new Error(`Informe o vencimento da parcela ${index + 1}.`);
    return {
      ...base,
      descricao: `${descricao}${parcelas.length > 1 ? ` - Parcela ${index + 1}/${parcelas.length}` : ""}`,
      valor: nonNegative(parcela.valor, `Valor da parcela ${index + 1}`),
      // `data` e o eixo do fluxo de caixa: enquanto pendente carrega o vencimento.
      // `vencimento_em` fica para baixar_transacao_pendente preencher.
      data: dataDoCalendario(vencimento),
      pendente: true,
    };
  });
}
