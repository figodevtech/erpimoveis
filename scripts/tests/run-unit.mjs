import { readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
function testsIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? testsIn(file) : /\.test\.tsx?$/.test(entry.name) ? [file] : [];
  });
}
/**
 * `node --test` trata cada caminho como PADRAO, nao como arquivo.
 *
 * Uma pasta de rota dinamica do Next (`[id]`) vira classe de caracteres: o
 * runner procurava `.../venda/i/route.test.ts`, nao achava, e seguia em
 * silencio — sem erro, sem aviso, so um arquivo a menos na contagem. Tres
 * testes viviam assim, incluindo a regra de competencia de eventos.
 *
 * `[[]` e uma classe que contem o proprio `[`, entao o colchete volta a valer
 * como literal. Funciona nos dois sistemas: escapar com barra invertida nao
 * serve no Windows, onde ela separa diretorio.
 */
const semGlob = (file) => file.replaceAll("[", "[[]");

const files = testsIn(path.join(root, "src")).sort();
if (!files.length) throw new Error("Nenhum teste de negócio encontrado.");
console.log(`Executando ${files.length} arquivos de teste.`);
const result = spawnSync(process.execPath, [
  "--import", "tsx", "--test", "--test-concurrency=4", ...process.argv.slice(2), ...files.map(semGlob),
], { cwd: root, stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
