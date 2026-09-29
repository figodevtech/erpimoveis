import "./__testEnv";

import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buscarKpisNotasEmitidasProprias, listarNotasEmitidas } from "./notasEmitidasService";

type Row = Record<string, any>;

function mockNotas(nfes: Row[], nfses: Row[], juncoes: Record<string, Row[]> = {}) {
  const tabelas: Record<string, Row[]> = {
    nfe: nfes,
    nfse: nfses,
    nfe_origem_vinculo: juncoes.nfe_origem_vinculo ?? [],
    nfe_saida_item_vinculo: juncoes.nfe_saida_item_vinculo ?? [],
  };
  mock.method(supabaseAdmin, "from", (table: string) => {
    assert.ok(table in tabelas);
    let rows = [...tabelas[table]];
    const query = {
      select: () => query,
      order: () => query,
      eq: (key: string, value: unknown) => {
        rows = rows.filter((row) => row[key] === value);
        return query;
      },
      in: (key: string, values: unknown[]) => {
        rows = rows.filter((row) => values.includes(row[key]));
        return query;
      },
      gte: (key: string, value: string) => {
        rows = rows.filter((row) => row[key] >= value);
        return query;
      },
      lte: (key: string, value: string) => {
        rows = rows.filter((row) => row[key] <= value);
        return query;
      },
      range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null }),
    };
    return query;
  });
}

const nfe: Row = {
  id: 1, modelo: "NFE", numero: 42, status: "AUTORIZADA",
  dataemissao: "2026-09-10T12:00:00Z", total_nfe: 100, is_deleted: false,
};
const nfse: Row = {
  id: 1, numero: "000123", status: "autorizado", referencia: "os-88-servicos",
  dataemissao: "2026-09-11T12:00:00Z", valor_total: "250.50", ordemservicoid: 88,
  cliente: { id: 5, nomerazaosocial: "Oficina São José", cpfcnpj: "12345678000199" },
  url_pdf: "https://example.com/nota.pdf",
};

afterEach(() => mock.restoreAll());

test("unifica NF-e e NFS-e antes de ordenar e paginar, preservando IDs coincidentes", async () => {
  mockNotas([nfe, { ...nfe, id: 2, is_deleted: true }], [nfse]);
  const first = await listarNotasEmitidas({ viewMode: "EMITIDAS_POR_NOS", limit: 1 });
  assert.equal(first.pagination.total, 2);
  assert.equal(first.pagination.totalPages, 2);
  assert.equal(first.data[0].modelo, "NFSE");
  assert.equal(first.data[0].numero, "000123");
  assert.equal(first.data[0].total_nfe, 250.5);
  assert.equal(first.data[0].status, "AUTORIZADA");
  assert.equal(first.data[0].url_pdf, nfse.url_pdf);
  const second = await listarNotasEmitidas({ page: 2, limit: 1 });
  assert.equal(second.data[0].modelo, "NFE");
  assert.equal(second.data[0].id, first.data[0].id);
});

test("filtra NFS-e por modelo, status normalizado, data, cliente e referência", async () => {
  mockNotas([nfe], [nfse, {
    ...nfse, id: 2, numero: null, status: "erro_autorizacao", dataemissao: null,
    createdat: "2026-09-12T12:00:00Z",
  }]);
  const result = await listarNotasEmitidas({
    modelo: "NFSE", status: "REJEITADA", dateFrom: "2026-09-12", dateTo: "2026-09-12",
    search: "sao jose os-88-servicos",
  });
  assert.equal(result.pagination.total, 1);
  assert.equal(result.data[0].id, 2);
  assert.equal(result.data[0].numero, "");
  assert.equal(result.data[0].dataemissao, "2026-09-12T12:00:00Z");
  assert.equal((await listarNotasEmitidas({ modelo: "NFE" })).data[0].modelo, "NFE");
  assert.equal((await listarNotasEmitidas({ modelo: "NFE" })).pagination.total, 1);
  assert.equal((await listarNotasEmitidas({ viewMode: "EMITIDAS_TERCEIROS" })).pagination.total, 0);
});

test("inclui serviços nos indicadores gerais de emissão própria", async () => {
  mockNotas([nfe], [nfse, { ...nfse, id: 2, status: "cancelado", valor_total: 30 }]);
  const kpis = await buscarKpisNotasEmitidasProprias();
  assert.equal(kpis.total, 3);
  assert.equal(kpis.emitidasPorNos, 3);
  assert.equal(kpis.autorizadas, 2);
  assert.equal(kpis.canceladas, 1);
  assert.equal(kpis.valorEmitidasPorNos, 380.5);
});

test("não perde notas quando há mais de mil registros na origem", async () => {
  mockNotas([], Array.from({ length: 1001 }, (_, i) => ({ ...nfse, id: i + 1 })));
  const result = await listarNotasEmitidas({ modelo: "NFSE", page: 11, limit: 100 });
  assert.equal(result.pagination.total, 1001);
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].id, 1);
});

test("filtra notas próprias por origem e faixa de valor antes da paginação", async () => {
  mockNotas([
    { ...nfe, id: 1, ordemservicoid: 10, total_nfe: 100 },
    { ...nfe, id: 2, vendaid: 20, total_nfe: 200 },
    { ...nfe, id: 3, entradaid: 30, total_nfe: 300 },
    { ...nfe, id: 4, saidaid: 40, total_nfe: 400 },
    { ...nfe, id: 5, total_nfe: 500 },
  ], [nfse]);

  const vendas = await listarNotasEmitidas({ origem: "VENDA", valorMin: "150", valorMax: "250" });
  assert.equal(vendas.pagination.total, 1);
  assert.equal(vendas.data[0].id, 2);

  const avulsas = await listarNotasEmitidas({ origem: "AVULSA", valorMin: "250,00" });
  assert.deepEqual(avulsas.data.map((nota) => nota.modelo), ["NFE"]);
  assert.equal(avulsas.data[0].id, 5);
});

test("agrupa os status intermediários no filtro em processamento", async () => {
  mockNotas([
    { ...nfe, id: 1, status: "ASSINADA" },
    { ...nfe, id: 2, status: "ENVIADA" },
    { ...nfe, id: 3, status: "PENDENTE_ENVIO" },
    { ...nfe, id: 4, status: "AUTORIZADA" },
  ], []);

  const result = await listarNotasEmitidas({ status: "PROCESSANDO" });
  assert.equal(result.pagination.total, 3);
  assert.deepEqual(result.data.map((nota) => nota.id), [3, 2, 1]);
});

test("traz todas as origens da nota consolidada, não só a âncora", async () => {
  mockNotas([
    { ...nfe, id: 1, ordemservicoid: 10 },
    { ...nfe, id: 2, saidaid: 40 },
  ], [nfse], {
    nfe_origem_vinculo: [
      { nfe_id: 1, tipo: "OS", origem_id: 10, ancora: true },
      { nfe_id: 1, tipo: "OS", origem_id: 11, ancora: false },
    ],
    nfe_saida_item_vinculo: [
      { nfe_id: 2, saida_id: 40 },
      { nfe_id: 2, saida_id: 41 },
    ],
  });

  const result = await listarNotasEmitidas({});
  const porNota = new Map(result.data.map((nota) => [`${nota.modelo}-${nota.id}`, nota.origens]));
  assert.deepEqual(porNota.get("NFE-1"), [
    { tipo: "OS", id: 10, ancora: true },
    { tipo: "OS", id: 11, ancora: false },
  ]);
  assert.deepEqual(porNota.get("NFE-2"), [
    { tipo: "SAIDA", id: 40, ancora: true },
    { tipo: "SAIDA", id: 41, ancora: false },
  ]);
  // A NFS-e 1 não herda as junções da NF-e 1: os ids coincidem, as tabelas não.
  assert.deepEqual(porNota.get("NFSE-1"), [{ tipo: "OS", id: 88, ancora: true }]);
});
