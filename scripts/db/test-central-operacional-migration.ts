/**
 * Valida a Central Operacional em uma transacao externa sempre revertida.
 *
 * Uso:
 *   npm run db:test:central-operacional
 *   npm run db:test:central-operacional -- demir
 */
import fs from "node:fs";
import path from "node:path";

import {
  connectDatabase,
  loadDatabaseConfigs,
  projectRoot,
  type DatabaseKey,
} from "./lib";

const VALID_DATABASES: DatabaseKey[] = ["demo", "demir", "alpha", "garage"];
const MIGRATION = "supabase/migrations/20260828140000_central_operacional_fase1.sql";
const CHECKS = "supabase/tests/central_operacional.sql";

function unwrapTransaction(sql: string, closingStatement: "commit" | "rollback") {
  const normalized = sql.replace(/^\uFEFF/, "");
  const pattern = new RegExp(`^\\s*begin\\s*;([\\s\\S]*)${closingStatement}\\s*;\\s*$`, "i");
  const match = normalized.match(pattern);
  if (!match) {
    throw new Error(`Envelope invalido: esperado BEGIN ... ${closingStatement.toUpperCase()}.`);
  }
  return match[1];
}

async function main() {
  const key = (process.argv[2] ?? "demo") as DatabaseKey;
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
    console.log(`Validando Central Operacional em ${database.label}...`);
    await client.query("BEGIN");
    await client.query(migration);
    await client.query(checks);
    await client.query("ROLLBACK");
    console.log("OK — migracao e testes passaram; transacao revertida.");
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
