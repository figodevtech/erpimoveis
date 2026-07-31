import {
  inspectDatabase,
  loadDatabaseConfigs,
  readLocalMigrations,
  runDatabasePush,
} from "./lib";

async function main() {
  const migrations = readLocalMigrations();
  const demo = loadDatabaseConfigs().find((database) => database.key === "demo");
  if (!demo) throw new Error("Banco de Demonstração não configurado.");

  const before = await inspectDatabase(demo, migrations);
  if (before.remoteOnly.length) {
    throw new Error("A Demonstração possui migrations somente no remoto.");
  }
  if (!before.pending.length) {
    console.log("Demonstração já está atualizada. Nenhuma migration pendente.");
    return;
  }

  console.log("Migrations que serão aplicadas na Demonstração:");
  before.pending.forEach((migration) =>
    console.log(`- ${migration.version}_${migration.name}`),
  );

  console.log("\nDry-run da Demonstração...");
  await runDatabasePush(demo, true);
  console.log("Aplicando somente na Demonstração...");
  await runDatabasePush(demo, false);

  const after = await inspectDatabase(demo, migrations);
  if (after.pending.length || after.remoteOnly.length) {
    throw new Error("A validação pós-deploy da Demonstração falhou.");
  }
  console.log("Demonstração atualizada. Teste o ERP antes de atualizar os clientes.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
