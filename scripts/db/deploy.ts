import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  DEFAULT_DATABASE_KEY,
  inspectDatabase,
  loadDatabaseConfigs,
  printInspectionSummary,
  readLocalMigrations,
  runDatabasePush,
} from "./lib";

const flags = new Set(process.argv.slice(2));

async function confirm(expected: string, message: string, bypass: boolean) {
  if (bypass) return;
  if (!process.stdin.isTTY) {
    throw new Error(
      `Confirmação interativa indisponível. Use --approve somente após revisar o dry-run.`,
    );
  }

  const prompt = createInterface({ input, output });
  try {
    const answer = await prompt.question(`${message}\nDigite ${expected}: `);
    if (answer.trim().toUpperCase() !== expected) {
      throw new Error("Deploy cancelado pelo usuário.");
    }
  } finally {
    prompt.close();
  }
}

async function main() {
  const localMigrations = readLocalMigrations();
  const database = loadDatabaseConfigs().find((item) => item.key === DEFAULT_DATABASE_KEY);
  if (!database) throw new Error("Banco do ERP não configurado.");

  const before = await inspectDatabase(database, localMigrations);
  printInspectionSummary([before]);

  if (before.remoteOnly.length) {
    throw new Error(
      "Há migrations somente no remoto. Corrija o histórico antes do deploy.",
    );
  }
  if (!before.pending.length) {
    console.log(`\n${database.label} já está atualizado.`);
    return;
  }

  console.log(`\nDry-run de ${database.label}...`);
  await runDatabasePush(database, true);
  await confirm(
    "APLICAR",
    `Aplicar ${before.pending.length} migration(s) em ${database.label}?`,
    flags.has("--approve"),
  );
  await runDatabasePush(database, false);

  const after = await inspectDatabase(database, localMigrations);
  printInspectionSummary([after]);
  if (after.pending.length || after.remoteOnly.length) {
    throw new Error(`A validação pós-deploy de ${database.label} falhou.`);
  }
  if (after.anonRoutines.length) {
    throw new Error(
      "Deploy concluído, mas há funções do public executáveis por anon. Falta REVOKE em alguma migration.",
    );
  }

  console.log(`\nDeploy concluído: ${database.label} está atualizado.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
