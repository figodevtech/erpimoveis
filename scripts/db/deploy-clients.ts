import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  inspectAllDatabases,
  inspectDatabase,
  printInspectionSummary,
  readLocalMigrations,
  runDatabasePush,
  schemaDifferences,
} from "./lib";

async function confirmClients() {
  if (process.argv.includes("--approve")) return;
  if (!process.stdin.isTTY) {
    throw new Error("Confirmação indisponível. Use --approve somente após testar a Demonstração.");
  }

  const prompt = createInterface({ input, output });
  try {
    const answer = await prompt.question(
      "Confirma que a Demonstração foi testada? Digite CLIENTES: ",
    );
    if (answer.trim().toUpperCase() !== "CLIENTES") {
      throw new Error("Atualização dos clientes cancelada.");
    }
  } finally {
    prompt.close();
  }
}

async function main() {
  const migrations = readLocalMigrations();
  const initial = await inspectAllDatabases();
  const demo = initial.inspections.find(
    (inspection) => inspection.database.key === "demo",
  );
  const clients = initial.inspections.filter(
    (inspection) => inspection.database.key !== "demo",
  );

  if (!demo) throw new Error("Banco de Demonstração não configurado.");
  if (demo.pending.length || demo.remoteOnly.length) {
    throw new Error(
      "A Demonstração não está atualizada. Execute npm run db:deploy:demo primeiro.",
    );
  }
  if (clients.some((inspection) => inspection.remoteOnly.length)) {
    throw new Error("Um banco de cliente possui migrations somente no remoto.");
  }

  const nomesClientes = clients.map((inspection) => inspection.database.label).join(", ");
  const pendingClients = clients.filter((inspection) => inspection.pending.length);
  if (!pendingClients.length) {
    console.log(`${nomesClientes} já estão atualizados.`);
    return;
  }

  for (const client of pendingClients) {
    console.log(`\n${client.database.label}:`);
    client.pending.forEach((migration) =>
      console.log(`- ${migration.version}_${migration.name}`),
    );
  }

  await confirmClients();

  for (const client of pendingClients) {
    console.log(`\nDry-run de ${client.database.label}...`);
    await runDatabasePush(client.database, true);
    console.log(`Aplicando em ${client.database.label}...`);
    await runDatabasePush(client.database, false);

    const after = await inspectDatabase(client.database, migrations);
    if (after.pending.length || after.remoteOnly.length) {
      throw new Error(`A validação de ${client.database.label} falhou.`);
    }
  }

  const final = await inspectAllDatabases();
  printInspectionSummary(final.inspections);
  const historyDrift = final.inspections.some(
    (inspection) => inspection.pending.length || inspection.remoteOnly.length,
  );
  const differences = schemaDifferences(final.inspections);
  if (historyDrift || differences.length) {
    throw new Error("A comparação final encontrou divergências.");
  }
  console.log(
    `\n${nomesClientes} atualizados; os ${final.inspections.length} bancos estão alinhados.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
