import fs from "node:fs";
import { connectDatabase, loadDatabaseConfigs } from "./lib";
async function main() {
const config = loadDatabaseConfigs().find((c) => c.key === "cespedes")!;
const { client } = await connectDatabase(config);
client.on("notice", (notice) => console.log(notice.message));
try {
  await client.query("BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';");
  const exists = await client.query("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='imovel_canal_calendario' AND column_name='ultima_sincronizacao') AS applied");
  if (!exists.rows[0].applied) await client.query(fs.readFileSync("supabase/migrations/20261119130000_sincronizar_calendarios_imoveis.sql", "utf8").replace(/^BEGIN;\s*/i, "").replace(/COMMIT;\s*$/i, ""));
  await client.query(fs.readFileSync("supabase/tests/calendarios_imoveis.sql", "utf8"));
} finally { await client.query("ROLLBACK"); await client.end(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Falha no teste SQL."); process.exitCode = 1; });
