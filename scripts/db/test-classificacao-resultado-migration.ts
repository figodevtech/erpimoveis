/**
 * Valida a migration da Fase 1 dentro de uma transacao revertida.
 *
 * Uso:
 *   npm run db:test:classificacao-resultado
 *   npm run db:test:classificacao-resultado -- demir
 *
 * Alem de rodar as verificacoes de `supabase/tests/`, este runner prova o
 * criterio de saida da Fase 1: instalar o catalogo nao muda a DRE. Para isso
 * soma todas as linhas do template ANTES de aplicar a migration, aplica,
 * reaplica (idempotencia) e soma de novo. Qualquer diferenca aborta.
 */
import fs from "node:fs";
import path from "node:path";

import {
  DATABASE_KEYS,
  connectDatabase,
  loadDatabaseConfigs,
  projectRoot,
  type DatabaseKey,
} from "./lib";

const BANCOS: DatabaseKey[] = [...DATABASE_KEYS];
const MIGRATION = "supabase/migrations/20260908100000_classificacao_resultado_catalogo.sql";
const CHECKS = "supabase/tests/classificacao_resultado_catalogo.sql";

/** Janela ampla de proposito: a comparacao precisa cobrir todo o historico. */
const BASELINE = `
  WITH t AS (SELECT id FROM public.dre_template WHERE ativo ORDER BY versao DESC LIMIT 1)
  SELECT l.codigo, s.valor, s.lancamentos
    FROM t
    CROSS JOIN LATERAL public.dre_somar_por_linha(
      t.id, timestamptz '2000-01-01', timestamptz '2100-01-01') s
    JOIN public.dre_linha l ON l.id = s.linha_id
   ORDER BY l.codigo`;

function desembrulhar(sql: string, fim: "commit" | "rollback") {
  const normalizado = sql.replace(/^﻿/, "");
  const padrao = new RegExp(`\\bbegin\\s*;([\\s\\S]*)${fim}\\s*;\\s*$`, "i");
  const encontrado = normalizado.match(padrao);
  if (!encontrado) {
    throw new Error(`Envelope invalido: esperado BEGIN ... ${fim.toUpperCase()}.`);
  }
  return encontrado[1];
}

function serializar(rows: Record<string, unknown>[]) {
  return rows.map((r) => `${r.codigo}=${r.valor}/${r.lancamentos}`).join("|");
}

async function main() {
  const chave = (process.argv[2] ?? "demo") as DatabaseKey;
  if (!BANCOS.includes(chave)) {
    throw new Error(`Banco invalido: ${chave}. Use um de: ${BANCOS.join(", ")}.`);
  }
  const banco = loadDatabaseConfigs().find((item) => item.key === chave);
  if (!banco) throw new Error(`Banco ${chave} nao configurado.`);

  const migration = desembrulhar(fs.readFileSync(path.join(projectRoot, MIGRATION), "utf8"), "commit");
  const checks = desembrulhar(fs.readFileSync(path.join(projectRoot, CHECKS), "utf8"), "rollback");

  const { client } = await connectDatabase(banco);
  client.on("notice", (notice) => {
    if (notice.message) console.log(`  ${notice.message}`);
  });

  try {
    console.log(`Validando o catalogo de classificacao em ${banco.label}...`);
    await client.query("BEGIN");

    const antes = await client.query(BASELINE);
    console.log(`  Baseline: ${antes.rowCount} linha(s) da DRE com valor.`);

    await client.query(migration);
    console.log("  Migration aplicada.");

    // Reaplicar tem de ser inofensivo: o deploy pode repetir, e a Fase 4
    // instala contas padrao em cima deste mesmo catalogo.
    await client.query(migration);
    const { rows: catalogo } = await client.query(
      "SELECT count(*)::int AS total FROM public.classificacoes_resultado",
    );
    if (catalogo[0].total !== 37) {
      throw new Error(`Reaplicar duplicou o catalogo: ${catalogo[0].total} classificacoes.`);
    }
    console.log("  Reaplicada sem duplicar.");

    const depois = await client.query(BASELINE);
    if (serializar(antes.rows) !== serializar(depois.rows)) {
      throw new Error(
        "A DRE mudou depois de instalar o catalogo. A Fase 1 nao pode alterar nenhum total.",
      );
    }
    console.log("  DRE inalterada: mesmos valores e mesma contagem por linha.");

    await client.query(checks);
    await client.query("ROLLBACK");
    console.log("OK - migration, idempotencia e testes passaram; transacao revertida.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
