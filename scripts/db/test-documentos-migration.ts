/**
 * Valida, numa transação revertida, a tabela dos documentos dinâmicos.
 *
 * Uso:
 *   npm run db:test:documentos
 *   npm run db:test:documentos -- cespedes
 *
 * 1. As migrations pendentes aplicam sem erro, separadas como o `db push` separa.
 * 2. `supabase/tests/documento_modelo.sql` passa sobre elas: seed, checks,
 *    nome único por módulo, updated_at, seed que não ressuscita, acesso e
 *    auditoria.
 *
 * Mesmo cuidado dos demais: cada comando vai como prepared statement e um
 * COMMIT perdido não efetiva nada.
 */
import path from "node:path";
import fs from "node:fs";

import {
  DATABASE_KEYS,
  connectDatabase,
  loadDatabaseConfigs,
  projectRoot,
  readLocalMigrations,
  type DatabaseKey,
} from "./lib";
import { splitLikeSupabaseCli } from "./supabase-splitter";

const BANCOS: DatabaseKey[] = [...DATABASE_KEYS];
const CONTROLE_DE_TRANSACAO = /^(begin|start\s+transaction|commit|end|rollback|abort)\b/i;
const TESTE = path.join(projectRoot, "supabase", "tests", "documento_modelo.sql");

function semComentariosIniciais(comando: string) {
  return comando.replace(/^(\s*--[^\n]*(\n|$))+/, "").trim();
}

/** O envelope do arquivo sai; qualquer outro controle de transação é recusado. */
function lerComandos(arquivo: string, envelope: RegExp) {
  const sql = fs.readFileSync(arquivo, "utf8").replace(/^﻿/, "");
  const comandos: string[] = [];
  for (const comando of splitLikeSupabaseCli(sql)) {
    const nucleo = semComentariosIniciais(comando);
    if (!nucleo) continue;
    if (envelope.test(nucleo)) continue;
    if (CONTROLE_DE_TRANSACAO.test(nucleo)) {
      throw new Error(`${path.basename(arquivo)}: controle de transação fora do envelope (${nucleo.slice(0, 40)}); recusado.`);
    }
    comandos.push(comando);
  }
  return comandos;
}

async function main() {
  const chave = (process.argv[2] ?? "cespedes") as DatabaseKey;
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
    const { rows } = await client.query("SELECT current_setting('documentos_teste.guarda', true) AS guarda");
    if (rows[0]?.guarda !== "ativa") {
      throw new Error(`A transação do teste foi encerrada depois de ${depois}. Verifique o banco.`);
    }
  };

  try {
    console.log(`Validando os documentos dinâmicos em ${banco.label}...`);
    const { rows: historico } = await client.query<{ version: string }>(
      "SELECT version FROM supabase_migrations.schema_migrations",
    );
    const aplicadas = new Set(historico.map((row) => String(row.version)));
    const pendentes = readLocalMigrations().filter((migration) => !aplicadas.has(migration.version));
    const scripts = pendentes.map((migration) => ({
      migration,
      comandos: lerComandos(path.join(projectRoot, "supabase", "migrations", migration.file), /^(begin|commit)$/i),
    }));
    const teste = lerComandos(TESTE, /^(begin|rollback)$/i);
    let preparados = 0;

    await client.query("BEGIN");
    await client.query("SET LOCAL documentos_teste.guarda = 'ativa'");

    for (const { migration, comandos } of scripts) {
      for (const [indice, comando] of comandos.entries()) {
        try {
          await client.query({ name: `documentos_${preparados++}`, text: comando });
        } catch (error) {
          const detalhe = error instanceof Error ? error.message : String(error);
          throw new Error(`${migration.file}, comando ${indice}: ${detalhe}`);
        }
      }
      await guarda(migration.file);
      console.log(`  ${migration.file}: aplicada (${comandos.length} comandos)`);
    }

    for (const comando of teste) {
      await client.query({ name: `documentos_${preparados++}`, text: comando });
    }
    await guarda(path.basename(TESTE));

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
