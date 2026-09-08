import fs from "node:fs";
import path from "node:path";
import { connectDatabase, loadDatabaseConfigs, projectRoot } from "./lib";

async function main() {
  const demo = loadDatabaseConfigs().find((b) => b.key === "demo")!;
  const { client } = await connectDatabase(demo);
  const version = "20260908170000";
  const name = "condicoes_no_envio_faturamento";
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const existente = await client.query("SELECT version FROM supabase_migrations.schema_migrations WHERE version=$1", [version]);
    if (existente.rowCount) {
      console.log("Migration já registrada na demonstração.");
      return;
    }
    const sql = fs.readFileSync(path.join(projectRoot, `supabase/migrations/${version}_${name}.sql`), "utf8")
      .replace(/^BEGIN;/m, "").replace(/^COMMIT;/m, "");
    await client.query(sql);
    await client.query("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES($1,$2,$3)", [version,name,[sql]]);
    if (process.argv.includes("--apply")) {
      await client.query("COMMIT");
      console.log("Migration de condições no faturamento aplicada somente à demonstração.");
    } else console.log("Validação concluída; use --apply para aplicar à demonstração.");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}
main().catch((erro) => { console.error(erro instanceof Error ? erro.message : "Falha na migration"); process.exitCode = 1; });
