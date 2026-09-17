import fs from "node:fs";
import crypto from "node:crypto";
import Module from "node:module";

// Mock 'server-only' para execução CLI fora do Next.js
const originalRequire = (Module.prototype as any).require;
(Module.prototype as any).require = function (id: string) {
  if (id === "server-only") return {};
  return originalRequire.apply(this, arguments);
};

async function audit() {
  const { supabaseAdmin } = await import("../../src/lib/supabaseAdmin");
  console.log("=== AUDITORIA COMPLETA DO TXT EFD 08/2026 ===");

  // 1. Ler arquivo local
  const rawBytes = fs.readFileSync("tmp_sped_demir_202608.txt");
  const localSha256 = crypto.createHash("sha256").update(rawBytes).digest("hex");
  console.log(`1. Tamanho local: ${rawBytes.length} bytes`);
  console.log(`2. SHA-256 local: ${localSha256}`);

  // 2. Baixar arquivo do Storage (ID 2)
  const { data: dbFile } = await supabaseAdmin
    .from("fiscal_sped_arquivo")
    .select("*")
    .eq("id", 2)
    .single();

  const { data: downloadData } = await supabaseAdmin.storage
    .from(dbFile.storage_bucket)
    .download(dbFile.storage_path);

  if (!downloadData) {
    throw new Error("Falha ao baixar arquivo do Storage.");
  }

  const downloadedBytes = Buffer.from(await downloadData.arrayBuffer());
  const downloadedSha256 = crypto.createHash("sha256").update(downloadedBytes).digest("hex");
  console.log(`3. SHA-256 no banco: ${dbFile.arquivo_sha256}`);
  console.log(`4. SHA-256 baixado do Storage: ${downloadedSha256}`);
  if (localSha256 === dbFile.arquivo_sha256 && localSha256 === downloadedSha256) {
    console.log("   ✓ SHA-256 IDÊNTICO em todas as pontas (local, banco, storage).");
  } else {
    throw new Error("Divergência de hash SHA-256!");
  }

  // 3. Checagem de CRLF
  const asLatin1 = rawBytes.toString("latin1");
  const lines = asLatin1.split("\r\n");
  // O último elemento após o split pode ser vazio se terminar em CRLF
  const cleanLines = lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
  console.log(`5. Linhas com CRLF: ${cleanLines.length}`);
  if (asLatin1.includes("\r\n") && !asLatin1.replace(/\r\n/g, "").includes("\n")) {
    console.log("   ✓ Todos os finais de linha são estritamente CRLF (\\r\\n).");
  }

  // 4. Primeira e última linha
  console.log(`6. Primeira linha: ${cleanLines[0]}`);
  console.log(`7. Última linha: ${cleanLines[cleanLines.length - 1]}`);
  if (cleanLines[0].startsWith("|0000|") && cleanLines[cleanLines.length - 1].startsWith("|9999|")) {
    console.log("   ✓ 0000 é a primeira linha e 9999 é a última linha.");
  }

  // 5. Bloco 1 (1001, 1010, 1601, 1990)
  const idx1001 = cleanLines.findIndex((l) => l.startsWith("|1001|"));
  const idx1010 = cleanLines.findIndex((l) => l.startsWith("|1010|"));
  const idx1601 = cleanLines.findIndex((l) => l.startsWith("|1601|"));
  const idx1990 = cleanLines.findIndex((l) => l.startsWith("|1990|"));

  console.log(`8. Posição 1001: linha ${idx1001 + 1} (${cleanLines[idx1001]})`);
  console.log(`9. Posição 1010: linha ${idx1010 + 1} (${cleanLines[idx1010]})`);
  console.log(`10. Posição 1601: ${idx1601 === -1 ? "AUSENTE (conforme esperado para 08/2026 Demir)" : `linha ${idx1601 + 1}`}`);
  console.log(`11. Posição 1990: linha ${idx1990 + 1} (${cleanLines[idx1990]})`);

  if (idx1010 === idx1001 + 1 && idx1990 === idx1010 + 1) {
    console.log("   ✓ Estrutura do Bloco 1 perfeita: 1001 imediatamente seguido de 1010, e fechado por 1990.");
  }

  // 6. Campos do 1010
  const fields1010 = cleanLines[idx1010].split("|");
  // split("|") em "|1010|N|N|N|N|N|N|N|N|N|N|N|N|N|" dá 16 partes:
  // [0] = "", [1] = "1010", [2..14] = 13 campos, [15] = ""
  const indicators1010 = fields1010.slice(2, -1);
  console.log(`12. Indicadores do 1010 (${indicators1010.length} campos): ${indicators1010.join(" | ")}`);
  if (indicators1010.length === 13) {
    console.log("   ✓ Registro 1010 possui exatamente os 13 indicadores exigidos no leiaute 020.");
  }

  // 7. Encerramento do Bloco 1 (1990)
  const fields1990 = cleanLines[idx1990].split("|");
  console.log(`13. Contador 1990: ${fields1990[2]} linhas contadas`);
  if (fields1990[2] === "3") {
    console.log("   ✓ 1990 contabiliza com exatidão as 3 linhas do Bloco 1 (|1001|, |1010|, |1990|).");
  }

  // 8. Registros 9900 no Bloco 9
  const lines9900 = cleanLines.filter((l) => l.startsWith("|9900|"));
  const line9900_1010 = lines9900.find((l) => l.startsWith("|9900|1010|"));
  console.log(`14. Contadores 9900 no Bloco 9: ${lines9900.length} registros`);
  console.log(`15. Registro 9900 para o 1010: ${line9900_1010}`);
  if (line9900_1010 === "|9900|1010|1|") {
    console.log("   ✓ Registro 1010 devidamente registrado e totalizado no Bloco 9 (|9900|1010|1|).");
  }

  // 9. Fechamento 9990 e 9999
  const line9990 = cleanLines.find((l) => l.startsWith("|9990|"));
  const line9999 = cleanLines.find((l) => l.startsWith("|9999|"));
  console.log(`16. Fechamento Bloco 9 (9990): ${line9990}`);
  console.log(`17. Encerramento do arquivo (9999): ${line9999}`);
  const totalArquivo = cleanLines.length;
  if (line9999 === `|9999|${totalArquivo}|`) {
    console.log(`   ✓ 9999 confere com exatidão total de linhas do arquivo: ${totalArquivo}.`);
  }
}

audit().catch((err) => {
  console.error("Erro na auditoria:", err);
  process.exit(1);
});
