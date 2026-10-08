import { auditTarget, exportModel, installModel, registerTarget, seedTarget } from "./provisionamento";
import { readTarget } from "./provisionamento";
import { createAdministrator } from "./administrador";

async function main() {
  const command = process.argv[2];
  const apply = process.argv.includes("--aplicar");
  if (command === "exportar") await exportModel();
  else if (command === "instalar") await installModel(apply);
  else if (command === "auditar") await auditTarget();
  else if (command === "cadastrar") await registerTarget(apply);
  else if (command === "base") await seedTarget(apply);
  else if (command === "admin") await createAdministrator(readTarget().database, apply);
  else throw new Error("Uso: npm run db:novo-cliente -- exportar|instalar|base|admin|auditar|cadastrar [--aplicar]");
}

main().catch((error) => {
  console.error((error instanceof Error ? error.message : "Falha no provisionamento.").replace(/postgres(?:ql)?:\/\/\S+/g, "[conexao ocultada]"));
  process.exitCode = 1;
});
