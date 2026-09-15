import "./__testEnv";

import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buscarKpisNotasEmitidasProprias, listarNotasEmitidas } from "./notasEmitidasService";

type Row = Record<string, any>;

function mockNotas(nfes: Row[], nfses: Row[]) {
  mock.method(supabaseAdmin, "from", (table: string) => {
    assert.ok(["nfe", "nfse"].includes(table));
    let rows = [...(table === "nfse" ? nfses : nfes)];
    const query = {
      select: () => query,
      order: () => query,
      eq: (key: string, value: unknown) => {
        rows = rows.filter((row) => row[key] === value);
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
