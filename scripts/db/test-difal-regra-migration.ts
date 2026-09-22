/**
 * Valida a migration das regras de DIFAL numa transação revertida.
 *
 * Uso:
 *   npm run db:test:difal
 *   npm run db:test:difal -- demir
 *
 * Aplica TODAS as migrations pendentes do banco, na ordem de versão, como o
 * `db push --include-all` faria, e roda supabase/tests/fiscal_difal_regra.sql:
 *
 * 1. a carga inicial resolve PB -> PI em 22/09/2026 com 22,5% e FCP 0;
 * 2. a regra anterior do PI continua no banco, fechada, para nota antiga;
 * 3. FCP NULL e FCP 0 convivem como estados distintos;
 * 4. cadastro incoerente (tipo sem identificador, vigência invertida, UF
 *    inexistente, regra que não determina nada) é recusado pelos CHECK;
 * 5. duas regras ativas idênticas são barradas pelo índice único;
 * 6. RLS ligada, anon/authenticated sem privilégio, permissões criadas.
 *
 * Mesmo cuidado do teste do SPED: cada comando vai como prepared statement,
 * separado pelo parser da CLI, e um COMMIT perdido não efetiva nada.
 */
import fs from "node:fs";
import path from "node:path";

import {
  connectDatabase,
  loadDatabaseConfigs,
  projectRoot,
  readLocalMigrations,
  type DatabaseKey,
} from "./lib";
import { splitLikeSupabaseCli } from "./supabase-splitter";

const BANCOS: DatabaseKey[] = ["demo", "demir", "garage"];
const CHECK = "supabase/tests/fiscal_difal_regra.sql";
const CONTROLE_DE_TRANSACAO = /^(begin|start\s+transaction|commit|end|rollback|abort)\b/i;

function semComentariosIniciais(comando: string) {
  return comando.replace(/^(\s*--[^\n]*(\n|$))+/, "").trim();
}

function lerComandos(arquivo: string, envelope: "commit" | "rollback") {
  const sql = fs.readFileSync(arquivo, "utf8").replace(/^﻿/, "");
  const comandos: string[] = [];
  for (const comando of splitLikeSupabaseCli(sql)) {
    const nucleo = semComentariosIniciais(comando);
    if (!nucleo) continue;
    if (new RegExp(`^(begin|${envelope})$`, "i").test(nucleo)) continue;
    if (CONTROLE_DE_TRANSACAO.test(nucleo)) {
      throw new Error(`${path.basename(arquivo)}: controle de transação fora do envelope (${nucleo.slice(0, 40)}); recusado.`);
    }
    comandos.push(comando);
  }
  return comandos;
}

async function main() {
  const chave = (process.argv[2] ?? "demo") as DatabaseKey;
  if (!BANCOS.includes(chave)) throw new Error(`Banco inválido: ${chave}. Use um de: ${BANCOS.join(", ")}.`);
  const banco = loadDatabaseConfigs().find((item) => item.key === chave);
  if (!banco) throw new Error(`Banco ${chave} não configurado.`);

  const { client } = await connectDatabase(banco);
  client.on("notice", (notice) => {
    if (notice.message && !/already exists|does not exist|skipping/i.test(notice.message)) {
      console.log(`  ${notice.message}`);
    }
  });

  const guarda = async (depois: string) => {
    const { rows } = await client.query("SELECT current_setting('difal_regra_teste.guarda', true) AS guarda");
    if (rows[0]?.guarda !== "ativa") {
      throw new Error(`A transação do teste foi encerrada depois de ${depois}. Verifique o banco.`);
    }
  };

  try {
    console.log(`Validando a migration das regras de DIFAL em ${banco.label}...`);
    const { rows: historico } = await client.query<{ version: string }>(
      "SELECT version FROM supabase_migrations.schema_migrations",
    );
    const aplicadas = new Set(historico.map((row) => String(row.version)));
    const pendentes = readLocalMigrations().filter((migration) => !aplicadas.has(migration.version));
    const scripts = pendentes.map((migration) => ({
      migration,
      comandos: lerComandos(path.join(projectRoot, "supabase", "migrations", migration.file), "commit"),
    }));
    const check = lerComandos(path.join(projectRoot, CHECK), "rollback");
    let preparados = 0;

    await client.query("BEGIN");
    await client.query("SET LOCAL difal_regra_teste.guarda = 'ativa'");

    for (const { migration, comandos } of scripts) {
      for (const [indice, comando] of comandos.entries()) {
        try {
          await client.query({ name: `difal_regra_teste_${preparados++}`, text: comando });
        } catch (error) {
          const detalhe = error instanceof Error ? error.message : String(error);
          throw new Error(`${migration.file}, comando ${indice}: ${detalhe}`);
        }
      }
      await guarda(migration.file);
      console.log(`  ${migration.file}: aplicada (${comandos.length} comandos)`);
    }

    for (const comando of check) {
      await client.query({ name: `difal_regra_teste_${preparados++}`, text: comando });
    }
    await guarda(CHECK);
    console.log(`  ${path.basename(CHECK)}: ok`);

    await client.query("ROLLBACK");
    console.log(`OK - ${pendentes.length} migration(s) validadas em ${banco.label}; transação revertida.`);
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
