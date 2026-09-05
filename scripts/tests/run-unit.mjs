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
const files = testsIn(path.join(root, "src")).sort();
if (!files.length) throw new Error("Nenhum teste de negócio encontrado.");
console.log(`Executando ${files.length} arquivos de teste.`);
const result = spawnSync(process.execPath, [
  "--import", "tsx", "--test", "--test-concurrency=4", ...process.argv.slice(2), ...files,
], { cwd: root, stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
