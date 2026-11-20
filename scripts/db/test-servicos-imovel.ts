/**
 * Serviços do imóvel: aplica as migrations da limpeza e a dos serviços (esta, duas vezes) e roda
 * os cenários, numa transação sempre revertida.
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
  const anteriores = [
    "20261118120000_limpeza_imovel.sql",
    "20261118140000_limpeza_descricao.sql",
    "20261118150000_reserva_registro_checkin_checkout.sql",
    "20261118160000_editar_checkin_checkout.sql",
    "20261118170000_reabrir_limpeza.sql",
    "20261118180000_editar_limpeza.sql",
  ];
  const servicos = lerMigration("20261119160000_servicos_imovel.sql");
  const tests = semTransacao(fs.readFileSync(path.join(projectRoot, "supabase/tests/servicos_imovel.sql"), "utf8"));
  const { client } = await connectDatabase(config);
  client.on("notice", (notice) => { if (notice.message) console.log(notice.message); });
  try {
    await client.query("BEGIN; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='5s';");
    // Num banco que já tem os serviços, a tabela da limpeza não existe mais: as anteriores
    // só rodam enquanto ela existe (antes da migration dos serviços).
    const { rows } = await client.query<{ antes: boolean }>("SELECT to_regclass('public.imovel_servico') IS NULL AS antes");
    if (rows[0]?.antes) await client.query(anteriores.map(lerMigration).join("\n"));
    await client.query(servicos);
    // Reexecutar a migration não pode falhar nem duplicar o serviço, as permissões ou o perfil.
    await client.query(servicos);
    await client.query(tests);
    console.log("Serviços do imóvel: cenários aprovados (nada foi gravado).");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
