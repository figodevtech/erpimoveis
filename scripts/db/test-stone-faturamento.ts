import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { connectDatabase, loadDatabaseConfigs, projectRoot } from "./lib";

async function main() {
  const demo = loadDatabaseConfigs().find(item => item.key === "cespedes")!;
  const { client } = await connectDatabase(demo);
  const { client: concorrente } = await connectDatabase(demo);
  try {
    for (const file of ["faturamento_os.sql", "stone_confirmacao_estorno.sql"]) {
      await client.query(fs.readFileSync(path.join(projectRoot, "supabase/tests", file), "utf8"));
      console.log(`${file}: passou, com rollback.`);
    }
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock_shared(87009,1)");
    await concorrente.query("BEGIN");
    await concorrente.query("SET LOCAL lock_timeout='300ms'");
    await assert.rejects(concorrente.query("UPDATE config_geral SET habilitar_faturamento_os=true"),
      (error: any) => error.code === "55P03");
    await concorrente.query("ROLLBACK");
    await client.query("ROLLBACK");
    await concorrente.query("BEGIN");
    const ativacao = await concorrente.query("UPDATE config_geral SET habilitar_faturamento_os=true WHERE habilitar_faturamento_os=false");
    assert.ok(ativacao.rowCount);
    const obsoleto = await concorrente.query("UPDATE config_geral SET habilitar_faturamento_os=false WHERE habilitar_faturamento_os=false RETURNING id");
    assert.equal(obsoleto.rowCount, 0);
    await concorrente.query("ROLLBACK");
    console.log("Concorrência: operação financeira bloqueia mudança de modo; comparação rejeita gravação obsoleta.");
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await concorrente.query("ROLLBACK").catch(() => {});
    await client.end();
    await concorrente.end();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
