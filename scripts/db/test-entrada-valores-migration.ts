/** Valida a migration e as regressões em uma transação sempre revertida. */
import fs from "node:fs";
import path from "node:path";
import { connectDatabase, loadDatabaseConfigs, projectRoot } from "./lib";

async function main() {
  const key = process.argv[2] ?? "demo";
  const database = loadDatabaseConfigs().find((item) => item.key === key);
  if (!database) throw new Error(`Banco ${key} não configurado.`);
  const migration = fs.readFileSync(path.join(projectRoot,
    "supabase/migrations/20261016004029_entrada_ajuste_valores.sql"), "utf8")
    .replace(/^\s*BEGIN;/i, "").replace(/COMMIT;\s*$/i, "");
  const checks = fs.readFileSync(path.join(projectRoot, "supabase/tests/entrada_ajuste_valores.sql"), "utf8");
  const { client } = await connectDatabase(database);
  client.on("notice", (notice) => { if (notice.message) console.log(notice.message); });
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query(migration);
    await client.query(checks);
    console.log(`OK — valores de entrada em ${database.label}; todas as alterações serão revertidas.`);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
