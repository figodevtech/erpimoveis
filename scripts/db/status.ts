import {
  inspectAllDatabases,
  printInspectionSummary,
  schemaDifferences,
} from "./lib";

async function main() {
  console.log("Verificando Demonstração, Demir e Garage Premium...");
  const { inspections } = await inspectAllDatabases();
  printInspectionSummary(inspections);

  const hasMigrationDrift = inspections.some(
    (inspection) => inspection.pending.length || inspection.remoteOnly.length,
  );
  const differences = schemaDifferences(inspections);

  if (hasMigrationDrift || differences.length) {
    console.error("\nResultado: existem diferenças que exigem atenção.");
    process.exitCode = 1;
    return;
  }

  console.log("\nResultado: bancos alinhados e sem migrations pendentes.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
