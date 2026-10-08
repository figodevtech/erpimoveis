import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeConstraint, type DatabaseConfig } from "./lib";
import { hash, readModel, readTarget, type Model } from "./provisionamento";

test("rejeita SQL e metadados alterados, inclusive buckets e historico", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "erp-provisionamento-"));
  const sql = "CREATE TABLE public.exemplo(id integer);";
  const model: Model = {
    format: 1, generatedAt: "2026-10-08", sourceRef: "a".repeat(20), sqlHash: hash(sql), packageHash: "",
    schema: {}, migrations: [{ version: "20261008000000", name: "exemplo" }],
    buckets: [{ id: "privado", name: "privado", public: false, file_size_limit: null, allowed_mime_types: null }],
    baseData: {},
  };
  model.packageHash = hash(JSON.stringify({ sqlHash: model.sqlHash, sourceRef: model.sourceRef,
    schema: model.schema, migrations: model.migrations, buckets: model.buckets, baseData: model.baseData }));
  const save = (value: Model) => fs.writeFileSync(path.join(directory, "manifesto.json"), JSON.stringify(value));
  try {
    fs.writeFileSync(path.join(directory, "estrutura.sql"), sql);
    save(model);
    assert.equal(readModel(directory).model.buckets[0].public, false);
    fs.appendFileSync(path.join(directory, "estrutura.sql"), "DROP TABLE public.exemplo;");
    assert.throws(() => readModel(directory), /alterado\/invalido/);
    fs.writeFileSync(path.join(directory, "estrutura.sql"), sql);
    const changedBucket = structuredClone(model);
    changedBucket.buckets[0].public = true;
    save(changedBucket);
    assert.throws(() => readModel(directory), /alterado\/invalido/);
    const changedHistory = structuredClone(model);
    changedHistory.migrations.push({ version: "20261009000000", name: "nao_instalada" });
    save(changedHistory);
    assert.throws(() => readModel(directory), /alterado\/invalido/);
  } finally {
    // Caminho criado por mkdtemp neste teste, dentro do diretorio temporario.
    assert.equal(path.dirname(directory), os.tmpdir());
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("destino explicito rejeita URL de outro projeto, origem e variavel duplicada", () => {
  const reference = "b".repeat(20);
  const values: Record<string, string> = {
    NOVO_CLIENTE_KEY: "oficina_nova", NOVO_CLIENTE_NOME: "Oficina Nova", NOVO_CLIENTE_PROJECT_REF: reference,
    NOVO_CLIENTE_DATABASE_URL: `postgresql://postgres.${reference}:senha@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
    NOVO_CLIENTE_SUPABASE_URL: `https://${reference}.supabase.co`, NOVO_CLIENTE_SERVICE_ROLE_KEY: "chave_de_teste",
  };
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  const source: DatabaseConfig = { key: "demo", label: "Demonstracao", projectRef: "a".repeat(20), envName: "ERP_DB_DEMO", poolerHosts: [], url: "" };
  try {
    Object.assign(process.env, values);
    assert.equal(readTarget([source]).database.projectRef, reference);
    process.env.NOVO_CLIENTE_DATABASE_URL = values.NOVO_CLIENTE_DATABASE_URL.replace(reference, source.projectRef);
    assert.throws(() => readTarget([source]), /nao corresponde/);
    process.env.NOVO_CLIENTE_DATABASE_URL = values.NOVO_CLIENTE_DATABASE_URL;
    process.env.NOVO_CLIENTE_SUPABASE_URL = `https://${source.projectRef}.supabase.co`;
    assert.throws(() => readTarget([source]), /API/);
    process.env.NOVO_CLIENTE_SUPABASE_URL = values.NOVO_CLIENTE_SUPABASE_URL;
    const other: DatabaseConfig = { ...source, key: "outra", envName: "ERP_DB_OFICINA_NOVA" };
    assert.throws(() => readTarget([other]), /outro banco/);
    const sameReference: DatabaseConfig = { ...source, projectRef: reference };
    assert.throws(() => readTarget([sameReference]), /outro banco/);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("normaliza apenas a representacao equivalente dos casts de array", () => {
  const original = "CHECK (cor::text = ANY (ARRAY['vermelho'::character varying, 'amarelo'::character varying]::text[]))";
  const restored = "CHECK (cor::text = ANY (ARRAY['vermelho'::character varying::text, 'amarelo'::character varying::text]))";
  assert.equal(normalizeConstraint(original), normalizeConstraint(restored));
  assert.notEqual(normalizeConstraint(original), normalizeConstraint(restored.replace("amarelo", "azul")));
});
