/**
 * Valida a migração do chat sem persistir DDL nem dados.
 *
 * O runner remove e verifica os envelopes BEGIN/COMMIT e BEGIN/ROLLBACK antes
 * de abrir a própria transação. Isso impede que um COMMIT interno encerre a
 * transação de segurança do teste.
 *
 * Uso:
 *   npm run db:test:chat-migration
 *   npm run db:test:chat-migration -- cespedes
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

const VALID_DATABASES: DatabaseKey[] = [...DATABASE_KEYS];

function unwrapTransaction(sql: string, closingStatement: "commit" | "rollback") {
  const normalized = sql.replace(/^\uFEFF/, "");
  const pattern = new RegExp(
    `^\\s*begin\\s*;([\\s\\S]*)${closingStatement}\\s*;\\s*$`,
    "i",
  );
  const match = normalized.match(pattern);
  if (!match) {
    throw new Error(
      `Envelope transacional inválido: esperado BEGIN ... ${closingStatement.toUpperCase()}.`,
    );
  }
  return match[1];
}

async function main() {
  const key = (process.argv[2] ?? "cespedes") as DatabaseKey;
  if (!VALID_DATABASES.includes(key)) {
    throw new Error(`Banco inválido: ${key}. Use um de: ${VALID_DATABASES.join(", ")}.`);
  }

  const database = loadDatabaseConfigs().find((item) => item.key === key);
  if (!database) throw new Error(`Banco ${key} não configurado.`);

  const migration = unwrapTransaction(
    fs.readFileSync(
      path.join(
        projectRoot,
        "supabase/migrations/20260825190000_chat_interno_fase_1.sql",
      ),
      "utf8",
    ),
    "commit",
  );
  const checks = unwrapTransaction(
    fs.readFileSync(
      path.join(projectRoot, "supabase/tests/chat_fase1.sql"),
      "utf8",
    ),
    "rollback",
  );

  const { client } = await connectDatabase(database);
  client.on("notice", (notice) => {
    if (notice.message) console.log(notice.message);
  });

  const runScenario = async (name: string, prepare?: string) => {
    console.log(`\nCenário: ${name}`);
    await client.query("BEGIN");
    try {
      if (prepare) await client.query(prepare);
      await client.query(migration);
      await client.query(checks);
      await client.query("ROLLBACK");
      console.log("OK — transação revertida.");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  };

  try {
    await runScenario("reaplicação sobre o schema atual");
    await runScenario(
      "instalação com tabelas do chat ausentes",
      "DROP TABLE IF EXISTS public.chat_mensagem, public.chat_participante, public.chat_conversa CASCADE",
    );
    console.log("\nResultado: migração e testes do chat passaram sem persistir alterações.");
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
