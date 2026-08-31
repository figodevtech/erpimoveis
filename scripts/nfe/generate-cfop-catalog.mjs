import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import * as XLSX from "xlsx";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const xlsxPath = args.get("--xlsx");
const descriptionsCurrentPath = args.get("--descriptions-current");
const descriptionsLegacyPath = args.get("--descriptions-legacy");
const outputPath = args.get("--output") ?? "src/lib/nfe/cfopCatalog.generated.ts";

if (!xlsxPath || !descriptionsCurrentPath || !descriptionsLegacyPath) {
  throw new Error(
    "Uso: node scripts/nfe/generate-cfop-catalog.mjs --xlsx <arquivo> " +
      "--descriptions-current <html> --descriptions-legacy <html> [--output <arquivo>]",
  );
}

function decodeHtml(value) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function parseDescriptions(filePath) {
  const html = fs.readFileSync(filePath, "utf8");
  const descriptions = new Map();
  for (const match of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = decodeHtml(match[1]);
    const heading = text.match(/^([123567])\.(\d{3})\s+-\s+(.+)$/);
    if (!heading) continue;
    const code = `${heading[1]}${heading[2]}`;
    const description = heading[3].replace(/\s+/g, " ").trim();
    if (description && !descriptions.has(code)) descriptions.set(code, description);
  }
  return descriptions;
}

function excelDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const br = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return String(value).slice(0, 10);
}

function indicator(value) {
  return Number(value ?? 0) === 1;
}

const descriptions = parseDescriptions(descriptionsCurrentPath);
for (const [code, description] of parseDescriptions(descriptionsLegacyPath)) {
  if (!descriptions.has(code)) descriptions.set(code, description);
}

const sourceBytes = fs.readFileSync(xlsxPath);
const workbook = XLSX.read(sourceBytes, { type: "buffer", cellDates: false });
const sheet = workbook.Sheets.CFOP;
if (!sheet) throw new Error('A planilha oficial não contém a aba "CFOP".');

const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
const entries = rows
  .map((row) => {
    const codigo = String(row.CFOP ?? "").replace(/\D/g, "").padStart(4, "0");
    return {
      codigo,
      descricao: descriptions.get(codigo) ?? "",
      inicioVigencia: excelDate(row["Início de vigência"]),
      fimVigencia: excelDate(row["Fim de vigência"]),
      indNFe: indicator(row.indNFe),
      indComunica: indicator(row.indComunica),
      indTransp: indicator(row.indTransp),
      indDevol: indicator(row.indDevol),
      indRetor: indicator(row.indRetor),
      indAnula: indicator(row.indAnula),
      indRemes: indicator(row.indRemes),
      indComb: indicator(row.indComb),
    };
  })
  .filter((entry) => /^\d{4}$/.test(entry.codigo) && entry.inicioVigencia)
  .sort((a, b) => a.codigo.localeCompare(b.codigo) || a.inicioVigencia.localeCompare(b.inicioVigencia));

const missingDescriptions = entries.filter((entry) => entry.indNFe && !entry.fimVigencia && !entry.descricao);
if (missingDescriptions.length) {
  throw new Error(`CFOPs vigentes sem descrição oficial: ${missingDescriptions.map((item) => item.codigo).join(", ")}`);
}
if (entries.some((entry) => entry.codigo === "6405" && !entry.fimVigencia)) {
  throw new Error("A fonte inesperadamente contém o CFOP 6405 vigente; revise a regra e a fonte.");
}
for (const expected of ["5102", "5405", "6102", "6401"]) {
  if (!entries.some((entry) => entry.codigo === expected && entry.indNFe && !entry.fimVigencia)) {
    throw new Error(`CFOP esperado não encontrado como vigente para NF-e: ${expected}`);
  }
}

const hash = crypto.createHash("sha256").update(sourceBytes).digest("hex").toUpperCase();
const header = `// Arquivo gerado por scripts/nfe/generate-cfop-catalog.mjs. Não edite manualmente.
// Fonte de existência/indicadores: Portal Nacional da NF-e, Tabela CFOP vigente desde 24/04/2023.
// Descrições: CONFAZ, Código Fiscal de Operações e Prestações consolidado.

import type { CfopCatalogEntry } from "./cfopTypes";

export const CFOP_CATALOG_SOURCE = ${JSON.stringify(
  {
    versao: "IT-2023.002-v1.00",
    vigencia: "2023-04-24",
    arquivo: "IT 2023.002-v1.00_Tabela_CFOP_Vigência_20230424.xlsx",
    sha256: hash,
    url: "https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=%2FNJarYc9nus%3D",
    descricaoUrl: "https://www.confaz.fazenda.gov.br/legislacao/ajustes/sinief/cfop_cvsn_1-6.24",
  },
  null,
  2,
)} as const;

export const CFOP_CATALOG = ${JSON.stringify(entries, null, 2)} satisfies readonly CfopCatalogEntry[];
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, header, "utf8");
process.stdout.write(`Gerados ${entries.length} registros em ${outputPath}.\n`);
