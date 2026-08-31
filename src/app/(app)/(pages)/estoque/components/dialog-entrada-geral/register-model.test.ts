import assert from "node:assert/strict";
import test from "node:test";
import { entradaUsoConsumoSchema } from "@/lib/usoconsumo/schemas";

import {
  adicionarOuIncrementarItem,
  buildEntradaPayload,
  criarItemDeSelecionavel,
  endpointDaEntrada,
  validarEntrada,
  type EntradaFinanceiroForm,
  type EntradaItemForm,
} from "./register-model";

const itemBase: EntradaItemForm = {
  itemId: 42,
  titulo: "Óleo lubrificante",
  referencia: "OLEO-1",
  unidade: "UN",
  ncm: "27101932",
  cest: null,
  csosn: "102",
  cfop: "1556",
  cst: null,
  aliquotaicms: 0,
  cstPis: "49",
  aliquotaPis: 0,
  cstCofins: "49",
  aliquotaCofins: 0,
  cClassTrib: "000001",
  cstIbs: null,
  cstCbs: null,
  cstIbsCbs: "000",
  aliquotaIbsUf: 0.1,
  aliquotaIbsMunicipio: 0,
  aliquotaCbs: 0.9,
  quantidade: 2,
  valorUnitarioCompra: 25,
};

function financeiro(
  change: Partial<EntradaFinanceiroForm> = {},
): EntradaFinanceiroForm {
  return {
    lancar: false,
    pagamentoFuturo: true,
    parcelas: [],
    bancoId: null,
    metodoPagamento: null,
    categoria: null,
    categoriaId: null,
    planoContaId: null,
    centroCustoId: null,
    nomePagador: "Fornecedor",
    cpfCnpjPagador: "NAO INFORMADO",
    ...change,
  };
}

test("normaliza produtos e itens simples no mesmo modelo", () => {
  const item = criarItemDeSelecionavel({
    id: 7,
    titulo: "Papel A4",
    cfop: "5102",
    cfop_entrada: "1556",
    cclass_trib: "000002",
    cst_ibscbs: "200",
    ultimovalordecompra: 12.5,
  });

  assert.equal(item.itemId, 7);
  assert.equal(item.cfop, "1556");
  assert.equal(item.cClassTrib, "000002");
  assert.equal(item.cstIbsCbs, "200");
  assert.equal(item.valorUnitarioCompra, 12.5);
  assert.equal(item.quantidade, 1);
});

test("adiciona itens distintos e incrementa uma seleção repetida", () => {
  const primeiro = adicionarOuIncrementarItem([], itemBase);
  const repetido = adicionarOuIncrementarItem(primeiro, itemBase);
  const distinto = adicionarOuIncrementarItem(repetido, {
    ...itemBase,
    itemId: 43,
  });

  assert.equal(primeiro.length, 1);
  assert.equal(repetido.length, 1);
  assert.equal(repetido[0].quantidade, 3);
  assert.equal(distinto.length, 2);
});

test("gera o payload legado de produtos com vários itens", () => {
  const payload = buildEntradaPayload({
    inventory: "produto",
    fornecedorId: 3,
    tipo: "COMPRA_FORNECEDOR",
    itens: [
      { ...itemBase, cstIbs: "100", cstCbs: "200", cstIbsCbs: null },
      { ...itemBase, itemId: 43, quantidade: 1 },
    ],
    financeiro: financeiro(),
  }) as any;

  assert.equal(endpointDaEntrada("produto"), "/api/entradas/geral");
  assert.equal(payload.fornecedorid, 3);
  assert.equal(payload.itens.length, 2);
  assert.equal(payload.itens[0].produto_id, 42);
  assert.equal(payload.itens[0].precovenda, 25);
  assert.equal(payload.itens[0].valor_unitario_compra, 25);
  assert.equal(payload.itens[0].cstIbs, "100");
  assert.equal(payload.itens[0].cstCbs, "200");
  assert.equal(payload.financeiro.lancar, false);
});

test("gera entrada parcelada somente no estoque simples informado", () => {
  const payload = buildEntradaPayload({
    inventory: "usoconsumo",
    escopo: "USOCONSUMO",
    fornecedorId: null,
    tipo: "COMPRA_FORNECEDOR",
    itens: [itemBase],
    financeiro: financeiro({
      lancar: true,
      categoria: "Materiais",
      categoriaId: 9,
      parcelas: [
        { id: 1, valor: 20, dataVencimento: "2026-09-10" },
        { id: 2, valor: 30, dataVencimento: "2026-10-10" },
      ],
    }),
  }) as any;

  assert.equal(
    endpointDaEntrada("usoconsumo"),
    "/api/usoconsumo/entradas/geral",
  );
  assert.equal(payload.escopo, "USOCONSUMO");
  assert.equal(payload.itens[0].item_id, 42);
  assert.equal(payload.itens[0].cfop, "1556");
  assert.equal(payload.itens[0].cst_ibscbs, "000");
  assert.equal(payload.transacoes.length, 2);
  assert.equal(payload.transacoes[0].pendente, true);
  assert.equal(payload.transacoes[0].valor, 20);
  assert.equal(payload.transacoes[0].vencimento_em, "2026-09-10T12:00:00");
  assert.match(payload.transacoes[1].descricao, /Parcela 2\/2/);
  assert.equal(entradaUsoConsumoSchema.safeParse(payload).success, true);
});

test("gera pagamento imediato para o estoque geral", () => {
  const now = new Date("2026-08-29T15:00:00.000Z");
  const payload = buildEntradaPayload({
    inventory: "usoconsumo",
    escopo: "GERAL",
    fornecedorId: 5,
    tipo: "COMPRA_FORNECEDOR",
    itens: [itemBase],
    financeiro: financeiro({
      lancar: true,
      pagamentoFuturo: false,
      bancoId: 2,
      metodoPagamento: "PIX",
      categoria: "Compras",
    }),
    now,
  }) as any;

  assert.equal(payload.escopo, "GERAL");
  assert.equal(payload.transacoes.length, 1);
  assert.equal(payload.transacoes[0].valor, 50);
  assert.equal(payload.transacoes[0].banco_id, 2);
  assert.equal(payload.transacoes[0].metodopagamento, "PIX");
  assert.equal(payload.transacoes[0].pendente, false);
  assert.equal(payload.transacoes[0].data, now.toISOString());
  assert.match(payload.transacoes[0].descricao, /estoque geral/);
  assert.equal(entradaUsoConsumoSchema.safeParse(payload).success, true);
});

test("exige escopo ao serializar um estoque simples", () => {
  assert.throws(
    () =>
      buildEntradaPayload({
        inventory: "usoconsumo",
        fornecedorId: null,
        tipo: "COMPRA_FORNECEDOR",
        itens: [itemBase],
        financeiro: financeiro(),
      }),
    /escopo é obrigatório/,
  );
});

test("valida quantidade, valor exigido e financeiro", () => {
  assert.match(
    validarEntrada({
      itens: [{ ...itemBase, quantidade: 0 }],
      exigeValor: true,
      financeiro: financeiro(),
    }) ?? "",
    /quantidade/,
  );

  assert.match(
    validarEntrada({
      itens: [{ ...itemBase, valorUnitarioCompra: 0 }],
      exigeValor: true,
      financeiro: financeiro(),
    }) ?? "",
    /exige valor unitário/,
  );

  assert.equal(
    validarEntrada({
      itens: [{ ...itemBase, valorUnitarioCompra: 0 }],
      exigeValor: false,
      financeiro: financeiro(),
    }),
    null,
  );

  assert.match(
    validarEntrada({
      itens: [itemBase],
      exigeValor: true,
      financeiro: financeiro({
        lancar: true,
        categoria: "Compras",
        parcelas: [
          { id: 1, valor: 49, dataVencimento: "2026-09-10" },
        ],
      }),
    }) ?? "",
    /parcelas deve ser igual/,
  );

  assert.match(
    validarEntrada({
      itens: [itemBase],
      exigeValor: true,
      financeiro: financeiro({
        lancar: true,
        pagamentoFuturo: false,
        categoria: "Compras",
      }),
    }) ?? "",
    /banco e o método/,
  );
});
