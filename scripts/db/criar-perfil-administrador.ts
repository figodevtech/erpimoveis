import { createAdministrator } from "./administrador";
import { loadDatabaseConfigs } from "./lib";

async function main() {
  const index = process.argv.indexOf("--banco");
  const key = index >= 0 ? process.argv[index + 1] : undefined;
  const database = loadDatabaseConfigs().find((item) => item.key === key);
  if (!database) throw new Error("Informe --banco com a chave do cliente cadastrado (ex.: jeancar).");
  await createAdministrator(database, process.argv.includes("--aplicar"));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Falha ao criar perfil."); process.exitCode = 1; });
