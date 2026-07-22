import { supabaseAdmin } from "@/lib/supabaseAdmin";

const TIPOS = new Set(["COMPRA_FORNECEDOR", "COMPRA_PF", "DEVOLUCAO"]);

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

type OrigemEntrada = "AJUSTE_RAPIDO" | "MANUAL" | "NFE_TERCEIRO";

export async function registrarEntradaConfirmada(body: any, origem: OrigemEntrada) {
  const rawItems = Array.isArray(body?.itens)
    ? body.itens
    : [{
        produto_id: body?.produto_id ?? body?.produtoid ?? body?.produtoId,
        quantidade: body?.quantidade,
        valor_unitario_compra:
          body?.valor_unitario_compra ?? body?.valor_unitario ?? body?.valorUnitario ?? body?.precovenda,
      }];

  if (!rawItems.length) throw new Error("Informe ao menos um produto para a entrada.");

  const tipoInformado = body?.entradaTipo ?? body?.tipo;
  const tipo = tipoInformado && TIPOS.has(String(tipoInformado))
    ? String(tipoInformado)
    : "COMPRA_FORNECEDOR";
  if (tipoInformado && !TIPOS.has(String(tipoInformado)) && origem !== "NFE_TERCEIRO") {
    throw new Error("Tipo de entrada inválido.");
  }

  const itens = rawItems.map((item: any, index: number) => ({
    produto_id: positiveInt(item.produto_id ?? item.produtoid ?? item.produtoId, `Produto ${index + 1}`),
    quantidade: positiveInt(item.quantidade, `Quantidade do produto ${index + 1}`),
    valor_unitario_compra: nonNegative(
      item.valor_unitario_compra ?? item.valorUnitario ?? item.valor_unitario ?? item.precovenda,
      `Valor unitário de compra do produto ${index + 1}`,
    ),
    valor_desconto: nonNegative(item.valor_desconto ?? item.valorDesconto ?? 0, `Desconto do produto ${index + 1}`),
    valor_frete: nonNegative(item.valor_frete ?? item.valorFrete ?? 0, `Frete do produto ${index + 1}`),
    outras_despesas: nonNegative(item.outras_despesas ?? item.outrasDespesas ?? 0, `Outras despesas do produto ${index + 1}`),
    unidade: text(item.unidade),
    ncm: text(item.ncm),
    cest: text(item.cest),
    csosn: text(item.csosn),
    referencia: text(item.referencia),
    titulo: text(item.titulo),
    cClassTrib: text(item.cClassTrib),
    cstIbs: text(item.cstIbs),
    cstCbs: text(item.cstCbs),
    cst: text(item.cst),
    aliquotaicms: item.aliquotaicms ?? null,
    cfop: text(item.cfop),
    cst_pis: text(item.cst_pis),
    aliquota_pis: item.aliquota_pis ?? null,
    cst_cofins: text(item.cst_cofins),
    aliquota_cofins: item.aliquota_cofins ?? null,
  }));

  const fiscal = origem === "NFE_TERCEIRO" || Boolean(body?.fiscal);
  const chave = digits(body?.notaChave ?? body?.notachave);
  if (fiscal && chave.length !== 44) throw new Error("A entrada fiscal exige uma chave de acesso válida com 44 dígitos.");

  const totalEntrada = itens.reduce(
    (sum: number, item: (typeof itens)[number]) => sum + item.quantidade * item.valor_unitario_compra - item.valor_desconto + item.valor_frete + item.outras_despesas,
    0,
  );

  const financeiro = body?.financeiro;
  const lancarFinanceiro = Boolean(financeiro?.lancar ?? body?.isPagamentoFuturo);
  let transacoes: any[] = [];

  if (lancarFinanceiro) {
    const futuro = Boolean(financeiro?.pagamentoFuturo ?? body?.isPagamentoFuturo);
    const parcelas = Array.isArray(financeiro?.parcelas ?? body?.parcelas)
      ? (financeiro?.parcelas ?? body?.parcelas)
      : [];
    const base = {
      metodopagamento: text(financeiro?.metodoPagamento ?? body?.metodoPagamento),
      categoria: text(financeiro?.categoria ?? body?.categoria) ?? "NÃO RELACIONADO",
      categoria_id: nullableId(financeiro?.categoriaId ?? body?.categoriaId, "Categoria"),
      banco_id: nullableId(financeiro?.bancoId ?? body?.bancoId, "Banco"),
      plano_de_conta_id: nullableId(financeiro?.planoContaId ?? body?.planoContaId, "Plano de conta"),
      plano_de_conta: text(financeiro?.planoConta ?? body?.planoConta),
      centro_custo_id: nullableId(financeiro?.centroCustoId ?? body?.centroCustoId, "Centro de custo"),
      centro_custo: text(financeiro?.centroCusto ?? body?.centroCusto),
      nomepagador: text(financeiro?.nomePagador ?? body?.nomePagador) ?? "Fornecedor",
      cpfcnpjpagador: digits(financeiro?.cpfCnpjPagador ?? body?.cpfCnpjPagador) || "NÃO INFORMADO",
    };

    if (futuro) {
      if (!parcelas.length) throw new Error("Informe ao menos uma parcela para o lançamento futuro.");
      transacoes = parcelas.map((parcela: any, index: number) => ({
        ...base,
        descricao: `${text(financeiro?.descricao ?? body?.descricaoTransacao) ?? "Compra de mercadorias"}${parcelas.length > 1 ? ` - Parcela ${index + 1}/${parcelas.length}` : ""}`,
        valor: nonNegative(parcela.valor, `Valor da parcela ${index + 1}`),
        data: text(parcela.dataVencimento ?? parcela.data),
        pendente: true,
      }));
    } else {
      if (!base.banco_id) throw new Error("Selecione o banco para lançar a compra no financeiro.");
      if (!base.metodopagamento) throw new Error("Selecione o método de pagamento para lançar a compra no financeiro.");
      transacoes = [{
        ...base,
        descricao: text(financeiro?.descricao ?? body?.descricaoTransacao) ?? "Compra de mercadorias",
        valor: Number(totalEntrada.toFixed(2)),
        data: text(financeiro?.dataPagamento) ?? new Date().toISOString(),
        pendente: false,
      }];
    }
  }

  const entrada = {
    fornecedorid: nullableId(body?.fornecedorId ?? body?.fornecedorid, "Fornecedor"),
    fiscal,
    notachave: fiscal ? chave : null,
    tipo,
    origem,
    numero_nota: text(body?.numeroNota ?? body?.numero_nota),
    serie_nota: text(body?.serie ?? body?.serieNota ?? body?.serie_nota),
    data_emissao: text(body?.dataEmissao ?? body?.data_emissao),
    fiscal_dfe_documento_id: nullableId(
      body?.documentoFiscalRecebidoId ?? body?.fiscalDfeDocumentoId,
      "Documento fiscal recebido",
    ),
    valor_total_documento:
      body?.valorTotalDocumento === null || body?.valorTotalDocumento === undefined
        ? null
        : nonNegative(body.valorTotalDocumento, "Total do documento"),
  };

  const { data, error } = await supabaseAdmin.rpc("registrar_entrada_confirmada", {
    p_entrada: entrada,
    p_itens: itens,
    p_transacoes: transacoes,
  });
  if (error) throw error;
  return data as { entrada_id: number; valor_total: number };
}

export function entradaErrorResponse(error: any) {
  const message = error?.message ?? "Não foi possível registrar a entrada.";
  if (Number.isInteger(error?.statusCode)) return { message, status: Number(error.statusCode) };
  const conflict = error?.code === "23505";
  const notFound = error?.code === "P0002";
  const invalid = error?.code === "22023" || /inválid|informe|exige|difere|obrigat/i.test(message);
  return { message, status: conflict ? 409 : notFound ? 404 : invalid ? 400 : 500 };
}
