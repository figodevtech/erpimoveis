/** Aplica a migration da limpeza duas vezes e roda os cenários, numa transação sempre revertida. */
import fs from "node:fs";
import path from "node:path";
import { connectDatabase, loadDatabaseConfigs, projectRoot } from "./lib";

const semTransacao = (sql: string) =>
  sql.replace(/^BEGIN;\s*$/gm, "").replace(/^COMMIT;\s*$/gm, "").replace(/^ROLLBACK;\s*$/gm, "");

async function main() {
  const config = loadDatabaseConfigs()[0];
  if (!config) throw new Error("Nenhum banco configurado.");
  const migration = [
    "20261118120000_limpeza_imovel.sql",
    "20261118140000_limpeza_descricao.sql",
    "20261118150000_reserva_registro_checkin_checkout.sql",
    "20261118160000_editar_checkin_checkout.sql",
    "20261118170000_reabrir_limpeza.sql",
    "20261118180000_editar_limpeza.sql",
  ]
    .map((arquivo) => semTransacao(fs.readFileSync(path.join(projectRoot, "supabase/migrations", arquivo), "utf8")))
    .join("\n");
  const tests = semTransacao(fs.readFileSync(path.join(projectRoot, "supabase/tests/limpeza_imovel.sql"), "utf8"));
  const { client } = await connectDatabase(config);
  client.on("notice", (notice) => { if (notice.message) console.log(notice.message); });
  try {
    await client.query("BEGIN; SET LOCAL statement_timeout='45s'; SET LOCAL lock_timeout='5s';");
    await client.query(migration);
    // Reexecutar a migration não pode falhar nem duplicar a permissão.
    await client.query(migration);
    await client.query(tests);
    console.log("Limpeza do imóvel: cenários aprovados (nada foi gravado).");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
