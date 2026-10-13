/** Aplica migrations pendentes somente no banco Jean Car. */
import {
  inspectDatabase,
  loadDatabaseConfigs,
  readLocalMigrations,
  runDatabasePush,
} from "./lib";

const APLICAR = process.argv.includes("--aplicar");

async function main() {
  const database = loadDatabaseConfigs().find((item) => item.key === "jeancar");
  if (!database) throw new Error("Banco Jean Car nao configurado.");

  const migrations = readLocalMigrations();
  const antes = await inspectDatabase(database, migrations);
  if (antes.remoteOnly.length) {
    throw new Error(`Jean Car possui migrations somente no remoto: ${antes.remoteOnly.join(", ")}.`);
  }
  if (!antes.pending.length) {
    console.log("Jean Car ja esta atualizado.");
    return;
  }

  console.log(`Migrations pendentes no Jean Car: ${antes.pending.map((item) => item.version).join(", ")}.`);
  await runDatabasePush(database, true);
  if (!APLICAR) {
    console.log("Dry-run concluido. Use --aplicar para efetivar somente no Jean Car.");
    return;
  }

  await runDatabasePush(database, false);
  const depois = await inspectDatabase(database, migrations);
  if (depois.pending.length || depois.remoteOnly.length) {
    throw new Error("Validacao posterior do Jean Car encontrou divergencia no historico.");
  }
  console.log("Jean Car atualizado e auditado.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

