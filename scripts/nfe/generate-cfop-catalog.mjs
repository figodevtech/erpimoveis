// Gera src/lib/nfe/cfopCatalog.generated.ts a partir da Tabela CFOP oficial do
// Portal Nacional da NF-e (Informe Técnico 2023.002).
//
// A planilha usada fica versionada em docs/fiscal/fontes/cfop/, com SHA256.txt
// e origem.md. Baixar de novo pelo link do Portal pode trazer outra versão.
//
// Uso (IT 2023.002 v2.10 em diante, que traz título e nota explicativa):
//   node scripts/nfe/generate-cfop-catalog.mjs \
//     --xlsx docs/fiscal/fontes/cfop/IT_2023_002_v2_10_Tabela_CFOP_Descricao.xlsx \
//     --versao IT-2023.002-v2.10 --publicacao 2026-09-04
//
// Tabelas anteriores à v2.10 não têm o título do CFOP; para elas, passe também
// --descriptions-current e --descriptions-legacy com o HTML consolidado do CONFAZ.
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
const versao = args.get("--versao");
const publicacao = args.get("--publicacao");
const descriptionsCurrentPath = args.get("--descriptions-current");
const descriptionsLegacyPath = args.get("--descriptions-legacy");
const outputPath = args.get("--output") ?? "src/lib/nfe/cfopCatalog.generated.ts";

if (!xlsxPath || !versao || !/^\d{4}-\d{2}-\d{2}$/.test(publicacao ?? "")) {
  throw new Error(
    "Uso: node scripts/nfe/generate-cfop-catalog.mjs --xlsx <arquivo> --versao <IT-2023.002-vX.YY> " +
      "--publicacao <AAAA-MM-DD> [--descriptions-current <html> --descriptions-legacy <html>] [--output <arquivo>]",
  );
}

const COLUNA_TITULO = "Título do CFOP";
const COLUNA_NOTA = "Descrição (nota explicativa)";

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

function arquivoDaFonte(filePath) {
  const relativo = path.relative(process.cwd(), path.resolve(filePath)).split(path.sep).join("/");
  return relativo.startsWith("..") || path.isAbsolute(relativo) ? path.basename(filePath) : relativo;
}

function indicator(value) {
  return Number(value ?? 0) === 1;
}

function texto(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

const sourceBytes = fs.readFileSync(xlsxPath);
const workbook = XLSX.read(sourceBytes, { type: "buffer", cellDates: false });
const sheet = workbook.Sheets.CFOP;
if (!sheet) throw new Error('A planilha oficial não contém a aba "CFOP".');

const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
const temTituloOficial = rows.some((row) => texto(row[COLUNA_TITULO]));

// Sem título na planilha, as descrições vêm do HTML do CONFAZ (tabelas antigas).
const descriptions = new Map();
if (!temTituloOficial) {
  if (!descriptionsCurrentPath || !descriptionsLegacyPath) {
    throw new Error(
      `A planilha não traz a coluna "${COLUNA_TITULO}". Informe --descriptions-current e --descriptions-legacy.`,
    );
  }
  for (const [code, description] of parseDescriptions(descriptionsCurrentPath)) descriptions.set(code, description);
  for (const [code, description] of parseDescriptions(descriptionsLegacyPath)) {
    if (!descriptions.has(code)) descriptions.set(code, description);
  }
}

const notas = new Map();
const entries = rows
  .map((row) => {
    const codigo = String(row.CFOP ?? "").replace(/\D/g, "").padStart(4, "0");
    if (temTituloOficial) notas.set(codigo, texto(row[COLUNA_NOTA]));
    return {
      codigo,
      descricao: temTituloOficial ? texto(row[COLUNA_TITULO]) : descriptions.get(codigo) ?? "",
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
      indExcIBSCBS: indicator(row.indExcIBSCBS),
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

// src/lib/nfe/icms/cfopSemantica.ts lê o papel da ST no título oficial e trata o
// 6404 como exceção documentada pela nota explicativa. Se a fonte mudar esses
// textos, a geração para aqui: a regra fiscal tem de ser revista antes.
const PREMISSAS_ST = [
  { codigo: "5401", campo: "titulo", trecho: /na condição de contribuinte substituto\b/i },
  { codigo: "5403", campo: "titulo", trecho: /na condição de contribuinte substituto\b/i },
  { codigo: "6401", campo: "titulo", trecho: /na condição de contribuinte substituto\b/i },
  { codigo: "6403", campo: "titulo", trecho: /na condição de contribuinte substituto\b/i },
  { codigo: "5405", campo: "titulo", trecho: /na condição de contribuinte substituído/i },
  { codigo: "6404", campo: "titulo", trecho: /cujo imposto já tenha sido retido anteriormente/i },
  { codigo: "6404", campo: "nota", trecho: /na condição de substituto tributário, exclusivamente nas hipóteses em que o imposto já tenha sido retido anteriormente/i },
];
for (const premissa of PREMISSAS_ST) {
  if (premissa.campo === "nota" && !temTituloOficial) continue;
  const valor =
    premissa.campo === "nota"
      ? notas.get(premissa.codigo) ?? ""
      : entries.find((entry) => entry.codigo === premissa.codigo && !entry.fimVigencia)?.descricao ?? "";
  if (!premissa.trecho.test(valor)) {
    throw new Error(
      `O ${premissa.campo} oficial do CFOP ${premissa.codigo} mudou ("${valor}"). Revise src/lib/nfe/icms/cfopSemantica.ts.`,
    );
  }
}

const hash = crypto.createHash("sha256").update(sourceBytes).digest("hex").toUpperCase();
const header = `// Arquivo gerado por scripts/nfe/generate-cfop-catalog.mjs. Não edite manualmente.
// Fonte: Portal Nacional da NF-e, Tabela CFOP (Informe Técnico ${versao.replace(/^IT-/, "")}), publicada em ${publicacao}.
// ${temTituloOficial ? `Descrição: coluna "${COLUNA_TITULO}" da própria tabela oficial.` : "Descrições: CONFAZ, Código Fiscal de Operações e Prestações consolidado."}

import type { CfopCatalogEntry } from "./cfopTypes";

export const CFOP_CATALOG_SOURCE = ${JSON.stringify(
  {
    versao,
    vigencia: publicacao,
    // Caminho no repositório quando a fonte está versionada; senão, o nome.
    arquivo: arquivoDaFonte(xlsxPath),
    sha256: hash,
    url: "https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=%2FNJarYc9nus%3D",
    descricao: temTituloOficial
      ? `Tabela CFOP oficial, coluna "${COLUNA_TITULO}"`
      : "https://www.confaz.fazenda.gov.br/legislacao/ajustes/sinief/cfop_cvsn_1-6.24",
  },
  null,
  2,
)} as const;

export const CFOP_CATALOG = ${JSON.stringify(entries, null, 2)} satisfies readonly CfopCatalogEntry[];
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, header, "utf8");
process.stdout.write(`Gerados ${entries.length} registros em ${outputPath}.\n`);
