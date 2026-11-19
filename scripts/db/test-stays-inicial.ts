import fs from "node:fs";
import { connectDatabase, loadDatabaseConfigs } from "./lib";
async function main() {
  const { client } = await connectDatabase(loadDatabaseConfigs().find((c) => c.key === "cespedes")!);
  client.on("notice", (notice) => console.log(notice.message));
  try {
    await client.query("BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';");
    const result = await client.query("SELECT to_regclass('public.imovel_stays_vinculo') IS NOT NULL AS applied");
    if (!result.rows[0].applied) await client.query(fs.readFileSync("supabase/migrations/20261119140000_integracao_stays_inicial.sql", "utf8").replace(/^BEGIN;\s*/i, "").replace(/COMMIT;\s*$/i, ""));
    await client.query(fs.readFileSync("supabase/tests/stays_inicial.sql", "utf8"));
  } finally { await client.query("ROLLBACK"); await client.end(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Falha no teste Stays."); process.exitCode = 1; });
