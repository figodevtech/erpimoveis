/**
 * Reservas do Airbnb: aplica a migration (duas vezes) e roda os cenários, numa transação
 * sempre revertida. Nada é gravado no banco.
 */
import fs from "node:fs";
import path from "node:path";
import { connectDatabase, loadDatabaseConfigs, projectRoot } from "./lib";

const semTransacao = (sql: string) =>
  sql.replace(/^BEGIN;\s*$/gm, "").replace(/^COMMIT;\s*$/gm, "").replace(/^ROLLBACK;\s*$/gm, "");

async function main() {
  const config = loadDatabaseConfigs()[0];
  if (!config) throw new Error("Nenhum banco configurado.");
  const migration = semTransacao(fs.readFileSync(path.join(projectRoot, "supabase/migrations/20261120140000_reservas_airbnb.sql"), "utf8"));
  const tests = semTransacao(fs.readFileSync(path.join(projectRoot, "supabase/tests/reservas_airbnb.sql"), "utf8"));
  const { client } = await connectDatabase(config);
  client.on("notice", (notice) => { if (notice.message) console.log(notice.message); });
  try {
    await client.query("BEGIN; SET LOCAL statement_timeout='90s'; SET LOCAL lock_timeout='5s';");
    await client.query(migration);
    // Reexecutar a migration não pode falhar.
    await client.query(migration);
    await client.query(tests);
    console.log("Reservas do Airbnb: cenários aprovados (nada foi gravado).");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
