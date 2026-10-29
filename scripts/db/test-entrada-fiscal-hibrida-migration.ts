/** Valida a migration hibrida e seus testes dentro de uma transacao revertida. */
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
const MIGRATION = "supabase/migrations/20260901233000_entrada_fiscal_hibrida.sql";
const CHECKS = "supabase/tests/entrada_fiscal_hibrida.sql";

function unwrapTransaction(sql: string, closingStatement: "commit" | "rollback") {
  const normalized = sql.replace(/^\uFEFF/, "");
  const pattern = new RegExp(
    `\\bbegin\\s*;([\\s\\S]*)${closingStatement}\\s*;\\s*$`,
    "i",
  );
  const match = normalized.match(pattern);
  if (!match) {
    throw new Error(
      `Envelope invalido: esperado BEGIN ... ${closingStatement.toUpperCase()}.`,
    );
  }
  return match[1];
}

async function main() {
  const key = (process.argv[2] ?? "cespedes") as DatabaseKey;
  if (!VALID_DATABASES.includes(key)) {
    throw new Error(`Banco invalido: ${key}. Use um de: ${VALID_DATABASES.join(", ")}.`);
  }
  const database = loadDatabaseConfigs().find((item) => item.key === key);
  if (!database) throw new Error(`Banco ${key} nao configurado.`);

  const migration = unwrapTransaction(
    fs.readFileSync(path.join(projectRoot, MIGRATION), "utf8"),
    "commit",
  );
  const checks = unwrapTransaction(
    fs.readFileSync(path.join(projectRoot, CHECKS), "utf8"),
    "rollback",
  );
  const { client } = await connectDatabase(database);
  client.on("notice", (notice) => {
    if (notice.message) console.log(notice.message);
  });

  try {
    console.log(`Validando entrada fiscal hibrida em ${database.label}...`);
    await client.query("BEGIN");
    await client.query(migration);
    await client.query(checks);
    await client.query("ROLLBACK");
    console.log("OK - migration e testes passaram; transacao revertida.");
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
