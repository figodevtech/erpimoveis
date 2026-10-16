import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SpedServiceError } from "./errors";
import { chunk, fetchAllByIds, fetchAllPages, SPED_PAGE_SIZE } from "./sourcePagination";

type Row = { id: number; [key: string]: unknown };

/** Simula o PostgREST: corta cada resposta em `maxRows`, como o Supabase faz em silêncio. */
function table(total: number, maxRows = SPED_PAGE_SIZE) {
  const rows: Row[] = Array.from({ length: total }, (_, index) => ({ id: index + 1 }));
  const calls: Array<{ from: number; to: number }> = [];
  const page = ({ from, to }: { from: number; to: number }) => {
    calls.push({ from, to });
    const slice = rows.slice(from, Math.min(to + 1, from + maxRows));
    return Promise.resolve({ data: slice, error: null, count: total });
  };
  return { rows, calls, page };
}

describe("coleta paginada", () => {
  it("lê 2.500 linhas em três páginas sem perder nem repetir", async () => {
    const source = table(2500);
    const result = await fetchAllPages("notas", source.page);
    assert.equal(result.rows.length, 2500);
    assert.equal(new Set(result.rows.map((row) => row.id)).size, 2500);
    assert.equal(result.report.pages, 3);
    assert.equal(result.report.expected, 2500);
  });

  it("um banco sem paginação (consulta única) teria truncado em 1.000", async () => {
    const source = table(2500);
    const single = await source.page({ from: 0, to: 9999 });
    assert.equal(single.data.length, 1000);
  });

  it("contagem exata múltipla do tamanho da página encerra sem página vazia extra", async () => {
    const source = table(2000);
    const result = await fetchAllPages("notas", source.page);
    assert.equal(result.rows.length, 2000);
    assert.equal(source.calls.length, 2);
  });

  it("recusa coleta incompleta: a fonte informa mais linhas do que vieram", async () => {
    const page = ({ from }: { from: number; to: number }) => Promise.resolve({
      data: from === 0 ? Array.from({ length: 10 }, (_, index) => ({ id: index + 1 })) : [],
      error: null,
      count: 11,
    });
    await assert.rejects(fetchAllPages("entradas", page, { pageSize: 10 }), (error: unknown) => {
      assert.ok(error instanceof SpedServiceError);
      assert.equal(error.code, "COLETA_INCOMPLETA");
      return true;
    });
  });

  it("recusa duplicidade entre páginas (ordem instável)", async () => {
    const page = ({ from }: { from: number; to: number }) => Promise.resolve({
      data: from === 0 ? [{ id: 1 }, { id: 2 }] : [{ id: 2 }],
      error: null,
      count: 3,
    });
    await assert.rejects(fetchAllPages("itens", page, { pageSize: 2 }), /duas páginas/);
  });

  it("propaga erro do banco com o nome da fonte", async () => {
    const page = () => Promise.resolve({ data: null, error: { message: "timeout", code: "57014" }, count: null });
    await assert.rejects(fetchAllPages("produtos", page), /Falha ao ler produtos: timeout/);
  });

  it("consulta por IDs em lotes, cada lote paginado", async () => {
    const ids = Array.from({ length: 450 }, (_, index) => index + 1);
    const batches: number[][] = [];
    const result = await fetchAllByIds("itens", ids, (part, { from, to }) => {
      if (from === 0) batches.push(part);
      const rows = part.flatMap((id) => [{ id: id * 10 }, { id: id * 10 + 1 }]);
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null, count: rows.length });
    }, { chunkSize: 200, pageSize: 300 });
    assert.deepEqual(batches.map((batch) => batch.length), [200, 200, 50]);
    assert.equal(result.rows.length, 900);
    assert.equal(result.report.expected, 900);
  });

  it("divide listas em lotes do tamanho pedido", () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunk([], 2), []);
  });
});
