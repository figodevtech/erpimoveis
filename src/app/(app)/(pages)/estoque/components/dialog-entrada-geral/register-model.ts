import type { UsoConsumoEscopo } from "@/lib/usoconsumo/escopo";

export type EntradaInventory = "produto" | "usoconsumo";

export type EntradaItemSelecionavel = {
  id?: number;
  titulo?: string | null;
  descricao?: string | null;
  referencia?: string | null;
  unidade?: string | null;
  ncm?: string | null;
  cest?: string | null;
  csosn?: string | null;
  cfop?: string | null;
  cfop_entrada?: string | null;
  cst?: string | null;
  aliquotaicms?: number | null;
  cst_pis?: string | null;
  aliquota_pis?: number | null;
  cst_cofins?: string | null;
  aliquota_cofins?: number | null;
  cClassTrib?: string | null;
  cclass_trib?: string | null;
  cstIbs?: string | null;
  cstCbs?: string | null;
  cst_ibscbs?: string | null;
  aliquota_ibs_uf?: number | null;
  aliquota_ibs_municipio?: number | null;
  aliquota_cbs?: number | null;
  ultimovalordecompra?: number | null;
  precocompra?: number | null;
};

export type EntradaItemForm = {
  itemId: number;
  titulo: string | null;
  referencia: string | null;
  unidade: string | null;
  ncm: string | null;
  cest: string | null;
  csosn: string | null;
  cfop: string | null;
  cst: string | null;
  aliquotaicms: number | null;
  cstPis: string | null;
  aliquotaPis: number | null;
  cstCofins: string | null;
  aliquotaCofins: number | null;
  cClassTrib: string | null;
  cstIbs: string | null;
  cstCbs: string | null;
  cstIbsCbs: string | null;
  aliquotaIbsUf: number | null;
  aliquotaIbsMunicipio: number | null;
  aliquotaCbs: number | null;
  quantidade: number;
  valorUnitarioCompra: number;
};

export type EntradaParcela = {
  id: number;
  dataVencimento?: string;
  valor: number;
};

export type EntradaFinanceiroForm = {
  lancar: boolean;
  pagamentoFuturo: boolean;
  parcelas: EntradaParcela[];
  bancoId: number | null;
  metodoPagamento: string | null;
  categoria: string | null;
  categoriaId: number | null;
  planoContaId: number | null;
  centroCustoId: number | null;
  nomePagador: string;
  cpfCnpjPagador: string;
};

export type BuildEntradaPayloadInput = {
  inventory: EntradaInventory;
  escopo?: UsoConsumoEscopo;
  fornecedorId: number | null;
  tipo: string;
  itens: EntradaItemForm[];
  financeiro: EntradaFinanceiroForm;
  now?: Date;
};

export type ValidateEntradaInput = {
  itens: EntradaItemForm[];
  exigeValor: boolean;
  financeiro: EntradaFinanceiroForm;
};

export function numero(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function textoOuNulo(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function numeroOuNulo(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function criarItemDeSelecionavel(item: EntradaItemSelecionavel): EntradaItemForm {
  return {
    itemId: numero(item.id),
    titulo: textoOuNulo(item.titulo) ?? textoOuNulo(item.descricao),
    referencia: textoOuNulo(item.referencia),
    unidade: textoOuNulo(item.unidade),
    ncm: textoOuNulo(item.ncm),
    cest: textoOuNulo(item.cest),
    csosn: textoOuNulo(item.csosn),
    cfop: textoOuNulo(item.cfop_entrada) ?? textoOuNulo(item.cfop),
    cst: textoOuNulo(item.cst),
    aliquotaicms: numeroOuNulo(item.aliquotaicms),
    cstPis: textoOuNulo(item.cst_pis),
    aliquotaPis: numeroOuNulo(item.aliquota_pis),
    cstCofins: textoOuNulo(item.cst_cofins),
    aliquotaCofins: numeroOuNulo(item.aliquota_cofins),
    cClassTrib: textoOuNulo(item.cClassTrib) ?? textoOuNulo(item.cclass_trib),
    cstIbs: textoOuNulo(item.cstIbs),
    cstCbs: textoOuNulo(item.cstCbs),
    cstIbsCbs: textoOuNulo(item.cst_ibscbs),
    aliquotaIbsUf: numeroOuNulo(item.aliquota_ibs_uf),
    aliquotaIbsMunicipio: numeroOuNulo(item.aliquota_ibs_municipio),
    aliquotaCbs: numeroOuNulo(item.aliquota_cbs),
    quantidade: 1,
    valorUnitarioCompra: numero(
      item.ultimovalordecompra ?? item.precocompra,
      0,
    ),
  };
}

export function adicionarOuIncrementarItem(
  itens: EntradaItemForm[],
  novoItem: EntradaItemForm,
) {
  const index = itens.findIndex((item) => item.itemId === novoItem.itemId);
  if (index < 0) return [...itens, novoItem];

  return itens.map((item, itemIndex) =>
    itemIndex === index
      ? { ...item, quantidade: numero(item.quantidade) + 1 }
      : item,
  );
}

export function totalDaEntrada(itens: EntradaItemForm[]) {
  return itens.reduce(
    (total, item) =>
      total + numero(item.quantidade) * numero(item.valorUnitarioCompra),
    0,
  );
}

export function validarEntrada({
  itens,
  exigeValor,
  financeiro,
}: ValidateEntradaInput): string | null {
  if (!itens.length) return "Adicione ao menos um item.";

  const itemInvalido = itens.findIndex(
    (item) =>
      !Number.isInteger(item.quantidade) ||
      item.quantidade <= 0 ||
      !Number.isFinite(item.valorUnitarioCompra) ||
      item.valorUnitarioCompra < 0,
  );
  if (itemInvalido >= 0) {
    return `Revise a quantidade e o valor do item ${itemInvalido + 1}. A quantidade deve ser um inteiro maior que zero.`;
  }

  if (exigeValor) {
    const semValor = itens.findIndex((item) => item.valorUnitarioCompra <= 0);
    if (semValor >= 0) {
      return `O tipo selecionado exige valor unitário maior que zero no item ${semValor + 1}.`;
    }
  }

  if (!financeiro.lancar) return null;

  const total = totalDaEntrada(itens);
  if (total <= 0) {
    return "O total da entrada deve ser maior que zero para gerar um lançamento financeiro.";
  }
  if (!financeiro.categoria) {
    return "Selecione a categoria do lançamento financeiro.";
  }

  if (financeiro.pagamentoFuturo) {
    if (
      !financeiro.parcelas.length ||
      financeiro.parcelas.some(
        (parcela) => !parcela.dataVencimento || parcela.valor <= 0,
      )
    ) {
      return "Informe uma data de vencimento e um valor positivo em todas as parcelas.";
    }
    const totalParcelas = financeiro.parcelas.reduce(
      (totalAtual, parcela) => totalAtual + parcela.valor,
      0,
    );
    if (Math.abs(totalParcelas - total) > 0.01) {
      return "A soma das parcelas deve ser igual ao total da entrada.";
    }
  } else if (!financeiro.bancoId || !financeiro.metodoPagamento) {
    return "Selecione o banco e o método de pagamento para o lançamento imediato.";
  }

  return null;
}

function camposComunsDoItem(item: EntradaItemForm) {
  return {
    quantidade: numero(item.quantidade),
    valor_unitario_compra: numero(item.valorUnitarioCompra),
    unidade: item.unidade,
    ncm: item.ncm,
    cest: item.cest,
    csosn: item.csosn,
    referencia: item.referencia,
    titulo: item.titulo,
    cst: item.cst,
    aliquotaicms: item.aliquotaicms,
    cfop: item.cfop,
    cst_pis: item.cstPis,
    aliquota_pis: item.aliquotaPis,
    cst_cofins: item.cstCofins,
    aliquota_cofins: item.aliquotaCofins,
  };
}

function dataFinanceira(value: string) {
  return value.includes("T") ? value : `${value}T12:00:00`;
}

function transacoesDeUsoConsumo(
  financeiro: EntradaFinanceiroForm,
  total: number,
  descricao: string,
  now: Date,
) {
  if (!financeiro.lancar) return [];

  const base = {
    metodopagamento: financeiro.metodoPagamento,
    categoria: financeiro.categoria ?? descricao,
    categoria_id: financeiro.categoriaId,
    banco_id: financeiro.bancoId,
    nomepagador: financeiro.nomePagador || "Fornecedor",
    cpfcnpjpagador: financeiro.cpfCnpjPagador || "NAO INFORMADO",
    plano_de_conta_id: financeiro.planoContaId,
    plano_de_conta: null,
    centro_custo_id: financeiro.centroCustoId,
    centro_custo: null,
  };

  if (financeiro.pagamentoFuturo) {
    return financeiro.parcelas.map((parcela, index) => {
      const vencimento = dataFinanceira(parcela.dataVencimento!);
      return {
        ...base,
        banco_id: null,
        metodopagamento: null,
        descricao: `${descricao}${financeiro.parcelas.length > 1 ? ` - Parcela ${index + 1}/${financeiro.parcelas.length}` : ""}`,
        valor: parcela.valor,
        data: vencimento,
        vencimento_em: vencimento,
        pendente: true,
      };
    });
  }

  return [
    {
      ...base,
      descricao,
      valor: Number(total.toFixed(2)),
      data: now.toISOString(),
      vencimento_em: null,
      pendente: false,
    },
  ];
}

export function buildEntradaPayload({
  inventory,
  escopo,
  fornecedorId,
  tipo,
  itens,
  financeiro,
  now = new Date(),
}: BuildEntradaPayloadInput) {
  const total = totalDaEntrada(itens);

  if (inventory === "produto") {
    return {
      fornecedorid: fornecedorId,
      fiscal: false,
      notachave: null,
      tipo,
      itens: itens.map((item) => ({
        produto_id: item.itemId,
        ...camposComunsDoItem(item),
        // Compatibilidade com clientes e rotas anteriores que chamavam o custo
        // unitario de `precovenda` dentro da entrada.
        precovenda: numero(item.valorUnitarioCompra),
        cClassTrib: item.cClassTrib,
        cstIbs: item.cstIbs,
        cstCbs: item.cstCbs,
      })),
      financeiro: {
        lancar: financeiro.lancar,
        pagamentoFuturo: financeiro.pagamentoFuturo,
        parcelas: financeiro.pagamentoFuturo
          ? financeiro.parcelas.map((parcela) => ({
              valor: parcela.valor,
              dataVencimento: parcela.dataVencimento!,
            }))
          : [],
        bancoId: financeiro.bancoId,
        metodoPagamento: financeiro.metodoPagamento,
        categoria: financeiro.categoria,
        categoriaId: financeiro.categoriaId,
        planoContaId: financeiro.planoContaId,
        centroCustoId: financeiro.centroCustoId,
        nomePagador: financeiro.nomePagador,
        cpfCnpjPagador: financeiro.cpfCnpjPagador,
        descricao: "Compra de mercadorias",
      },
    };
  }

  if (!escopo) {
    throw new Error("O escopo é obrigatório para uma entrada de estoque simples.");
  }

  const descricao =
    escopo === "GERAL"
      ? "Compra de material do estoque geral"
      : "Compra de material de uso e consumo";

  return {
    escopo,
    fornecedor_id: fornecedorId,
    fiscal: false,
    tipo,
    itens: itens.map((item) => ({
      item_id: item.itemId,
      ...camposComunsDoItem(item),
      cst_ibscbs: item.cstIbsCbs ?? item.cstIbs ?? item.cstCbs,
      cclass_trib: item.cClassTrib,
      aliquota_ibs_uf: item.aliquotaIbsUf,
      aliquota_ibs_municipio: item.aliquotaIbsMunicipio,
      aliquota_cbs: item.aliquotaCbs,
    })),
    transacoes: transacoesDeUsoConsumo(
      financeiro,
      total,
      descricao,
      now,
    ),
  };
}

export function endpointDaEntrada(inventory: EntradaInventory) {
  return inventory === "produto"
    ? "/api/entradas/geral"
    : "/api/usoconsumo/entradas/geral";
}
