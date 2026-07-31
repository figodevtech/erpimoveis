import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  inspectAllDatabases,
  inspectDatabase,
  loadDatabaseConfigs,
  printInspectionSummary,
  readLocalMigrations,
  runDatabasePush,
  schemaDifferences,
} from "./lib";

const flags = new Set(process.argv.slice(2));

async function confirm(expected: string, message: string, bypass: boolean) {
  if (bypass) return;
  if (!process.stdin.isTTY) {
    throw new Error(
      `Confirmação interativa indisponível. Use a opção correspondente somente após validar: ${expected}.`,
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
  const databases = loadDatabaseConfigs();
  const demo = databases.find((database) => database.key === "demo");
  const clients = databases.filter((database) => database.key !== "demo");
  if (!demo) throw new Error("Banco de Demonstração não configurado.");

  console.log("Pré-validação dos quatro bancos...");
  const initial = await inspectAllDatabases();
  printInspectionSummary(initial.inspections);

  if (initial.inspections.some((inspection) => inspection.remoteOnly.length)) {
    throw new Error(
      "Há migrations somente no remoto. Corrija o histórico antes do deploy.",
    );
  }

  let demoStatus = initial.inspections.find(
    (inspection) => inspection.database.key === "demo",
  );
  if (!demoStatus) throw new Error("Status da Demonstração não encontrado.");

  if (demoStatus.pending.length) {
    console.log("\nDry-run da Demonstração...");
    await runDatabasePush(demo, true);
    await confirm(
      "DEMO",
      `Aplicar ${demoStatus.pending.length} migration(s) na Demonstração?`,
      flags.has("--approve-demo"),
    );
    await runDatabasePush(demo, false);
    demoStatus = await inspectDatabase(demo, localMigrations);
    if (demoStatus.pending.length || demoStatus.remoteOnly.length) {
      throw new Error("A validação pós-deploy da Demonstração falhou.");
    }
    console.log("Demonstração atualizada com sucesso.");
  } else {
    console.log("\nDemonstração já está atualizada.");
  }

  const clientStatuses = await Promise.all(
    clients.map((database) => inspectDatabase(database, localMigrations)),
  );
  const pendingClients = clientStatuses.filter(
    (inspection) => inspection.pending.length,
  );

  if (pendingClients.length) {
    console.log(
      "\nTeste agora o ERP usando a Demonstração. Os bancos dos clientes ainda não foram alterados.",
    );
    await confirm(
      "CLIENTES",
      "Após validar a Demonstração, deseja atualizar Demir, AlphaGarage e Garage Premium?",
      flags.has("--approve-clients"),
    );

    for (const status of clientStatuses) {
      if (!status.pending.length) {
        console.log(`${status.database.label} já está atualizado.`);
        continue;
      }
      console.log(`\nDry-run de ${status.database.label}...`);
      await runDatabasePush(status.database, true);
      console.log(`Aplicando em ${status.database.label}...`);
      await runDatabasePush(status.database, false);
    }
  } else {
    console.log("Demir, AlphaGarage e Garage Premium já estão atualizados.");
  }

  console.log("\nValidação final...");
  const final = await inspectAllDatabases();
  printInspectionSummary(final.inspections);
  const hasHistoryDrift = final.inspections.some(
    (inspection) => inspection.pending.length || inspection.remoteOnly.length,
  );
  const differences = schemaDifferences(final.inspections);
  if (hasHistoryDrift || differences.length) {
    throw new Error(
      `Deploy concluído com divergências: ${differences.join(", ") || "histórico"}.`,
    );
  }

  console.log("\nDeploy concluído: os quatro bancos estão alinhados.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
