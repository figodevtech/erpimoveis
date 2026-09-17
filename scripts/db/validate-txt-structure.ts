import fs from "node:fs";
import { resolveSpedLayout } from "../../src/lib/sped/efd-icms-ipi/layout";

function validateTxt() {
  const content = fs.readFileSync("tmp_sped_demir_202608.txt", "latin1");
  const lines = content.split("\r\n").filter(Boolean);
  const layout = resolveSpedLayout("2026-08");

  console.log(`=== AUDITORIA DE CONFORMIDADE EFD LEIAUTE 020 ===`);
  console.log(`Total de linhas no arquivo: ${lines.length}`);

  let fieldMismatch = 0;
  let unknownRecords = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("|") || !line.endsWith("|")) {
      console.log(`Linha ${i + 1}: delimitadores inicial ou final ausentes: ${line}`);
      fieldMismatch++;
      continue;
    }

    const parts = line.split("|");
    const code = parts[1];
    const def = layout.records.get(code);

    if (!def) {
      console.log(`Linha ${i + 1}: registro desconhecido [${code}]`);
      unknownRecords++;
      continue;
    }

    // A linha começa com | e termina com |, logo split('|') tem:
    // parts[0] = "" (antes do primeiro pipe)
    // parts[1] = code
    // parts[2..n-1] = campos do registro
    // parts[n] = "" (depois do último pipe)
    // Total de partes esperado: def.fields.length + 3
    const expectedParts = def.fields.length + 3;
    if (parts.length !== expectedParts) {
      console.log(
        `Linha ${i + 1} [${code}]: esperado ${def.fields.length} campos, encontrado ${parts.length - 3}`
      );
      fieldMismatch++;
    }
  }

  if (unknownRecords === 0 && fieldMismatch === 0) {
    console.log(`\n✓ PERFEITO! TODAS as ${lines.length} linhas possuem rigorosamente:`);
    console.log(`  - Delimitadores '|' inicial e final;`);
    console.log(`  - Registro existente no Guia Prático 020;`);
    console.log(`  - Contagem exata de campos por registro conforme especificação oficial.`);
  } else {
    console.log(`\nErros encontrados: ${fieldMismatch} campos incorretos, ${unknownRecords} registros desconhecidos.`);
  }
}

validateTxt();
