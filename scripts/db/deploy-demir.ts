import {
  inspectDatabase,
  loadDatabaseConfigs,
  readLocalMigrations,
  runDatabasePush,
} from "./lib";

async function main() {
  const migrations = readLocalMigrations();
  const demir = loadDatabaseConfigs().find((database) => database.key === "demir");
  if (!demir) throw new Error("Banco Demir não configurado.");

  const before = await inspectDatabase(demir, migrations);
  if (before.remoteOnly.length) {
    throw new Error("O banco Demir possui migrations somente no remoto.");
  }
  if (!before.pending.length) {
    console.log("Demir já está atualizada. Nenhuma migration pendente.");
    return;
  }

  console.log("Migrations que serão aplicadas somente na Demir:");
  before.pending.forEach((migration) =>
    console.log(`- ${migration.version}_${migration.name}`),
  );
  console.log("\nDry-run da Demir...");
  await runDatabasePush(demir, true);
  console.log("Aplicando somente na Demir...");
  await runDatabasePush(demir, false);

  const after = await inspectDatabase(demir, migrations);
  if (after.pending.length || after.remoteOnly.length) {
    throw new Error("A validação pós-deploy da Demir falhou.");
  }
  console.log("Demir atualizada.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
