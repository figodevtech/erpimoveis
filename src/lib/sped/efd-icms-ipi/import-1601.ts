import { isValidCnpj, normalizeCnpj } from "@/lib/fiscal-identifiers";

const REQUIRED_COLUMNS = [
  "instituicao_cnpj",
  "instituicao_nome",
  "intermediario_cnpj",
  "intermediario_nome",
  "total_operacoes",
  "total_iss",
  "total_outros",
] as const;

export type Imported1601Line = {
  lineNumber: number;
  institutionCnpj: string;
  institutionName: string;
  institutionParticipantCode: string;
  intermediaryCnpj: string | null;
  intermediaryName: string | null;
  intermediaryParticipantCode: string | null;
  totalOperations: number;
  totalIss: number;
  totalOthers: number;
  source: Record<string, string>;
};

function splitCsvLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      values.push(current.trim());
      current = "";
    } else current += character;
  }
  if (quoted) throw new Error("CSV 1601 inválido: aspas não fechadas.");
  values.push(current.trim());
  return values;
}

function decimal(rawValue: string, delimiter: string, lineNumber: number, column: string): number {
  const raw = rawValue.trim();
  if (!raw) return 0;
  const normalized = delimiter === ";"
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`CSV 1601 inválido: ${column} inválido na linha ${lineNumber}.`);
  }
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`CSV 1601 inválido: ${column} inválido na linha ${lineNumber}.`);
  }
  return Math.round(value * 100) / 100;
}

function participantCode(prefix: "IP" | "IT", cnpj: string): string {
  return `${prefix}${cnpj}`;
}

export function parse1601Csv(content: string): Imported1601Line[] {
  const lines = content.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV 1601 inválido: cabeçalho ou dados ausentes.");
  const delimiter = lines[0].includes(";") ? ";" : ",";
  const header = splitCsvLine(lines[0], delimiter).map((column) => column.trim().toLowerCase());
  for (const column of REQUIRED_COLUMNS) {
    if (!header.includes(column)) throw new Error(`CSV 1601 inválido: coluna ${column} ausente.`);
  }

  const seen = new Set<string>();
  return lines.slice(1).map((line, index) => {
    const lineNumber = index + 2;
    const values = splitCsvLine(line, delimiter);
    if (values.length !== header.length) {
      throw new Error(`CSV 1601 inválido: quantidade de colunas divergente na linha ${lineNumber}.`);
    }
    const source = Object.fromEntries(header.map((column, columnIndex) => [column, values[columnIndex] ?? ""]));
    const institutionCnpj = normalizeCnpj(source.instituicao_cnpj);
    const intermediaryCnpj = normalizeCnpj(source.intermediario_cnpj) || null;
    if (!isValidCnpj(institutionCnpj)) {
      throw new Error(`CSV 1601 inválido: CNPJ da instituição inválido na linha ${lineNumber}.`);
    }
    if (intermediaryCnpj && !isValidCnpj(intermediaryCnpj)) {
      throw new Error(`CSV 1601 inválido: CNPJ do intermediário inválido na linha ${lineNumber}.`);
    }
    const institutionName = source.instituicao_nome.trim();
    const intermediaryName = source.intermediario_nome.trim() || null;
    if (!institutionName) throw new Error(`CSV 1601 inválido: nome da instituição ausente na linha ${lineNumber}.`);
    if (intermediaryCnpj && !intermediaryName) {
      throw new Error(`CSV 1601 inválido: nome do intermediário ausente na linha ${lineNumber}.`);
    }

    const identity = `${institutionCnpj}|${intermediaryCnpj ?? ""}`;
    if (seen.has(identity)) {
      throw new Error(`CSV 1601 inválido: instituição/intermediário duplicados na linha ${lineNumber}.`);
    }
    seen.add(identity);

    return {
      lineNumber,
      institutionCnpj,
      institutionName,
      institutionParticipantCode: participantCode("IP", institutionCnpj),
      intermediaryCnpj,
      intermediaryName,
      intermediaryParticipantCode: intermediaryCnpj ? participantCode("IT", intermediaryCnpj) : null,
      totalOperations: decimal(source.total_operacoes, delimiter, lineNumber, "total_operacoes"),
      totalIss: decimal(source.total_iss, delimiter, lineNumber, "total_iss"),
      totalOthers: decimal(source.total_outros, delimiter, lineNumber, "total_outros"),
      source,
    };
  });
}
