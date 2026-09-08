/**
 * O catálogo existe em dois lugares: neste módulo, que a aplicação usa, e na
 * migration que o semeia no banco. Divergir entre os dois produziria uma tela
 * dizendo uma coisa e uma DRE somando outra — e ninguém perceberia até o
 * fechamento não bater.
 *
 * Este teste lê a migration e compara. É o preço de ter as duas cópias; a
 * alternativa, gerar o SQL em tempo de deploy, tornaria a migration não
 * reproduzível a partir do repositório.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { CLASSIFICACOES } from "./catalogo";

const MIGRATION = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260908100000_classificacao_resultado_catalogo.sql",
);

const sql = fs.readFileSync(MIGRATION, "utf8");

/** Extrai as linhas de um `VALUES` delimitado pelo comentário/prefixo dado. */
function bloco(inicio: string, fim: string) {
  const de = sql.indexOf(inicio);
  assert.ok(de >= 0, `Bloco não encontrado na migration: ${inicio}`);
  const ate = sql.indexOf(fim, de);
  assert.ok(ate > de, `Fim do bloco não encontrado: ${fim}`);
  return sql.slice(de, ate);
}

const blocoSeed = bloco("WITH dados(codigo,", "INSERT INTO public.classificacoes_resultado");
const blocoDestinos = bloco("destinos(codigo, linha_codigo) AS (VALUES", "INSERT INTO public.dre_mapeamento");

type LinhaSeed = { codigo: string; tratamento: string; naturezas: string[]; papel: string | null };

function lerSeed(): LinhaSeed[] {
  const linhas: LinhaSeed[] = [];
  const padrao =
    /^\s*\('([A-Z_]+)',.*?'(RESULTADO|PATRIMONIAL)', ARRAY\[([^\]]*)\], (?:'([A-Z]+)'|NULL),/gm;
  for (const m of blocoSeed.matchAll(padrao)) {
    linhas.push({
      codigo: m[1],
      tratamento: m[2],
      naturezas: m[3].split(",").map((n) => n.trim().replace(/'/g, "")),
      papel: m[4] ?? null,
    });
  }
  return linhas;
}

function lerDestinos() {
  const destinos = new Map<string, string>();
  for (const m of blocoDestinos.matchAll(/\('([A-Z_]+)', '([0-9.]+)'\)/g)) {
    destinos.set(m[1], m[2]);
  }
  return destinos;
}

const seed = lerSeed();
const destinos = lerDestinos();

test("a migration semeia exatamente as classificações do módulo", () => {
  const noSql = new Set(seed.map((l) => l.codigo));
  const noTs = new Set(CLASSIFICACOES.map((c) => c.codigo));

  const faltamNoSql = [...noTs].filter((c) => !noSql.has(c));
  const sobramNoSql = [...noSql].filter((c) => !noTs.has(c));

  assert.deepEqual(faltamNoSql, [], "classificações do módulo ausentes na migration");
  assert.deepEqual(sobramNoSql, [], "classificações da migration ausentes no módulo");
  assert.equal(seed.length, CLASSIFICACOES.length, "a migration repete alguma chave");
});

test("tratamento, papel e naturezas conferem entre módulo e migration", () => {
  for (const linha of seed) {
    const modulo = CLASSIFICACOES.find((c) => c.codigo === linha.codigo);
    assert.ok(modulo, linha.codigo);
    assert.equal(linha.tratamento, modulo.tratamento, `${linha.codigo}: tratamento`);
    assert.equal(linha.papel, modulo.papelDre, `${linha.codigo}: papel na DRE`);
    assert.deepEqual(linha.naturezas, modulo.naturezas, `${linha.codigo}: naturezas`);
  }
});

test("destinos da migration conferem com as linhas do módulo", () => {
  for (const classificacao of CLASSIFICACOES) {
    if (classificacao.tratamento === "PATRIMONIAL") {
      assert.equal(
        destinos.has(classificacao.codigo),
        false,
        `${classificacao.codigo} é patrimonial e não pode ter linha de destino`,
      );
      continue;
    }
    assert.equal(
      destinos.get(classificacao.codigo),
      classificacao.linhaCodigo,
      `${classificacao.codigo}: linha de destino`,
    );
  }
});

test("a migration não deixa destino órfão", () => {
  const conhecidas = new Set(CLASSIFICACOES.map((c) => c.codigo));
  for (const codigo of destinos.keys()) {
    assert.ok(conhecidas.has(codigo), `destino para classificação inexistente: ${codigo}`);
  }
});
