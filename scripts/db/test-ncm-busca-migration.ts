/**
 * Valida a migration da busca de NCM numa transação revertida.
 *
 * Uso:
 *   npm run db:test:ncm
 *   npm run db:test:ncm -- cespedes
 *
 * Aplica as migrations pendentes, como o `db push --include-all` faria, e roda
 * supabase/tests/fiscal_ncm_busca.sql:
 *
 * 1. código exato, código inexistente e prefixo de subposição;
 * 2. busca por descrição sem acento acha o texto acentuado;
 * 3. HTML do portal não entra na coluna de busca;
 * 4. a coluna gerada não aceita escrita direta e se mantém sozinha;
 * 5. recorte de vigência esconde código encerrado e acha o histórico;
 * 6. índice de trigrama existe e a RLS continua fechada.
 *
 * Mesmo cuidado dos demais: cada comando vai como prepared statement e um
 * COMMIT perdido não efetiva nada.
 */
import fs from "node:fs";
import path from "node:path";

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
const CHECK = "supabase/tests/fiscal_ncm_busca.sql";
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
    const { rows } = await client.query("SELECT current_setting('ncm_busca_teste.guarda', true) AS guarda");
    if (rows[0]?.guarda !== "ativa") {
      throw new Error(`A transação do teste foi encerrada depois de ${depois}. Verifique o banco.`);
    }
  };

  try {
    console.log(`Validando a migration da busca de NCM em ${banco.label}...`);
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
    await client.query("SET LOCAL ncm_busca_teste.guarda = 'ativa'");

    for (const { migration, comandos } of scripts) {
      for (const [indice, comando] of comandos.entries()) {
        try {
          await client.query({ name: `ncm_busca_teste_${preparados++}`, text: comando });
        } catch (error) {
          const detalhe = error instanceof Error ? error.message : String(error);
          throw new Error(`${migration.file}, comando ${indice}: ${detalhe}`);
        }
      }
      await guarda(migration.file);
      console.log(`  ${migration.file}: aplicada (${comandos.length} comandos)`);
    }

    for (const comando of check) {
      await client.query({ name: `ncm_busca_teste_${preparados++}`, text: comando });
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
