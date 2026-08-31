/** Aplica migrations pendentes somente no banco Garage Premium. */
import {
  inspectDatabase,
  loadDatabaseConfigs,
  readLocalMigrations,
  runDatabasePush,
} from "./lib";

const APLICAR = process.argv.includes("--aplicar");

async function main() {
  const database = loadDatabaseConfigs().find((item) => item.key === "garage");
  if (!database) throw new Error("Banco Garage Premium nao configurado.");

  const migrations = readLocalMigrations();
  const antes = await inspectDatabase(database, migrations);
  if (antes.remoteOnly.length) {
    throw new Error(`Garage Premium possui migrations somente no remoto: ${antes.remoteOnly.join(", ")}.`);
  }
  if (!antes.pending.length) {
    console.log("Garage Premium ja esta atualizado.");
    return;
  }

  console.log(`Migrations pendentes no Garage Premium: ${antes.pending.map((item) => item.version).join(", ")}.`);
  await runDatabasePush(database, true);
  if (!APLICAR) {
    console.log("Dry-run concluido. Use --aplicar para efetivar somente no Garage Premium.");
    return;
  }

  await runDatabasePush(database, false);
  const depois = await inspectDatabase(database, migrations);
  if (depois.pending.length || depois.remoteOnly.length) {
    throw new Error("Validacao posterior do Garage Premium encontrou divergencia no historico.");
  }
  console.log("Garage Premium atualizado e auditado.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

