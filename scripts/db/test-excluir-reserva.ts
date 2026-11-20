/**
 * Exclusão definitiva da reserva: aplica a migration (duas vezes) e roda os cenários, numa
 * transação sempre revertida. Num banco ainda sem os serviços do imóvel, aplica antes a
 * migration deles (20261119160000), de que esta depende.
 */
import fs from "node:fs";
import path from "node:path";
import { connectDatabase, loadDatabaseConfigs, projectRoot } from "./lib";

const semTransacao = (sql: string) =>
  sql.replace(/^BEGIN;\s*$/gm, "").replace(/^COMMIT;\s*$/gm, "").replace(/^ROLLBACK;\s*$/gm, "");

const lerMigration = (arquivo: string) =>
  semTransacao(fs.readFileSync(path.join(projectRoot, "supabase/migrations", arquivo), "utf8"));

async function main() {
  const config = loadDatabaseConfigs()[0];
  if (!config) throw new Error("Nenhum banco configurado.");
  const exclusao = lerMigration("20261120120000_excluir_reserva_definitivo.sql");
  const tests = semTransacao(fs.readFileSync(path.join(projectRoot, "supabase/tests/excluir_reserva.sql"), "utf8"));
  const { client } = await connectDatabase(config);
  client.on("notice", (notice) => { if (notice.message) console.log(notice.message); });
  try {
    await client.query("BEGIN; SET LOCAL statement_timeout='90s'; SET LOCAL lock_timeout='5s';");
    const { rows } = await client.query<{ sem_servicos: boolean }>("SELECT to_regclass('public.imovel_servico') IS NULL AS sem_servicos");
    if (rows[0]?.sem_servicos) await client.query(lerMigration("20261119160000_servicos_imovel.sql"));
    await client.query(exclusao);
    // Reexecutar a migration não pode falhar.
    await client.query(exclusao);
    await client.query(tests);
    console.log("Exclusão definitiva da reserva: cenários aprovados (nada foi gravado).");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
