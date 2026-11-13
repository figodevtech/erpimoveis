import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type Row = Record<string, any>;

// Exercita a implementação real sem abrir conexões nem carregar credenciais.
function loadData(tables: Record<string, Row[]>, failure?: string) {
  const queries: string[] = [], urls: string[] = [];
  const db = {
    from(table: string) {
      queries.push(table);
      const filters: Array<(row: Row) => boolean> = [];
      const query: any = {
        select: () => query, order: () => query,
        eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
        is: (key: string, value: unknown) => { filters.push(row => (row[key] ?? null) === value); return query; },
        in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({
          data: (tables[table] ?? []).filter(row => filters.every(filter => filter(row))),
          error: table === failure ? new Error("falha simulada") : null,
        })),
      };
      return query;
    },
    storage: { from: () => ({ getPublicUrl(file: string) {
      urls.push(file);
      return { data: { publicUrl: `https://storage.example/${file}` } };
    } }) },
  };
  const source = readFileSync(path.join(process.cwd(), "src/lib/imobiliario/data.ts"), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} as any };
  runInNewContext(output, {
    Buffer,
    exports: loaded.exports,
    require(name: string) {
      if (name === "server-only" || name === "node:crypto") return {};
      if (name === "./server") return { db };
      if (name === "./types") return { IMOBILIARIO_BUCKET_FOTOS: "fotos" };
      throw new Error(`Dependência não simulada: ${name}`);
    },
  });
  return { api: loaded.exports, queries, urls };
}

const photo = (imovel_id: number, file: string, extra: Row = {}) => ({ imovel_id, path: file, tipo: "FOTO", bucket: "fotos", publico: true, ...extra });

test("reservas compartilham relações e capa sem misturar clientes ou gerar a mesma URL novamente", async () => {
  const { api, queries, urls } = loadData({
    imovel_resumo: [{ id: 10, titulo: "Flat" }],
    cliente: [{ id: 2, nome: "Cliente A" }, { id: 3, nome: "Cliente B" }],
    proprietario: [{ id: 4, nome: "Titular" }],
    imovel_arquivo: [photo(10, "capa.webp"), photo(10, "segunda.webp")],
  });
  const result = await api.enrich([
    { id: 100, imovel_id: 10, cliente_id: 2, proprietario_id: 4 },
    { id: 101, imovel_id: 10, comprador_id: 3, proprietario_id: 4, foto_capa: "capa-preservada" },
    { id: 102, imovel_id: 99, cliente_id: 99 },
  ]);
  assert.equal(result[0].cliente.nome, "Cliente A");
  assert.equal(result[1].cliente.nome, "Cliente B");
  assert.equal(result[0].proprietario.nome, "Titular");
  assert.equal(result[0].imovel.foto_capa, "https://storage.example/capa.webp");
  assert.equal(result[1].foto_capa, "capa-preservada");
  assert.equal(result[2].imovel, undefined);
  assert.equal(result[2].foto_capa, null);
  assert.deepEqual(urls, ["capa.webp"]);
  assert.equal(queries.length, 4);
});

test("galeria mantém ordem e isolamento por imóvel e não expõe anexos privados", async () => {
  const { api } = loadData({ imovel_arquivo: [
    photo(10, "primeira.webp"), photo(20, "outro.webp"), photo(10, "segunda.webp"),
    photo(10, "privado.webp", { publico: false }), photo(10, "reserva.webp", { reserva_id: 8 }),
  ] });
  const result = await api.publicFlats([{ id: 10, endereco: { rua: "privada" }, cpf: "privado" }, { id: 20 }, { id: 30 }]);
  assert.equal(JSON.stringify(result[0].gallery), JSON.stringify(["https://storage.example/primeira.webp", "https://storage.example/segunda.webp"]));
  assert.equal(result[0].coverImage, "https://storage.example/primeira.webp");
  assert.equal(result[1].gallery.length, 1);
  assert.equal(result[2].gallery.length, 0);
  assert.equal("endereco" in result[0], false);
  assert.equal("cpf" in result[0], false);
});

test("lista vazia não consulta banco e falha de relação não vira cadastro parcial", async () => {
  const empty = loadData({});
  await empty.api.enrich([]);
  await empty.api.publicFlats([]);
  assert.equal(empty.queries.length, 0);
  const failed = loadData({}, "cliente");
  await assert.rejects(failed.api.enrich([{ cliente_id: 1 }]), /falha simulada/);
});
