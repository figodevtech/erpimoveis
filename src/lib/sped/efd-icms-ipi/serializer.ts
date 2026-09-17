import { formatEfdDate } from "@/lib/fiscal-date";

import type {
  EfdFieldDefinition,
  EfdFieldPrimitive,
  EfdLayout,
  EfdRecord,
  SerializedEfd,
} from "./types";

function replaceUnsupportedCharacter(character: string): string {
  const code = character.codePointAt(0) ?? 0;
  if (code >= 32 && code <= 255) return character;
  if (character === "\t") return " ";
  if (["\u2018", "\u2019", "\u201A", "\u201B"].includes(character)) return "'";
  if (["\u201C", "\u201D", "\u201E", "\u201F"].includes(character)) return '"';
  if (["\u2013", "\u2014", "\u2212"].includes(character)) return "-";
  return code < 32 ? "" : "?";
}

export function sanitizeEfdText(value: unknown): string {
  return Array.from(String(value ?? "").replace(/[|\r\n]+/g, " "))
    .map(replaceUnsupportedCharacter)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalDecimal(value: EfdFieldPrimitive, scale: number): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Valor decimal não finito.");
  }

  if (typeof value === "number") {
    const multiplier = 10 ** scale;
    const scaled = value * multiplier;
    const quantized = Math.round(scaled);
    if (Math.abs(scaled - quantized) > 1e-7) {
      throw new Error(`Valor decimal ${value} excede ${scale} casas; quantize na regra de origem.`);
    }
    const negative = quantized < 0;
    const digits = Math.abs(quantized).toString().padStart(scale + 1, "0");
    const whole = scale > 0 ? digits.slice(0, -scale) : digits;
    const fraction = scale > 0 ? digits.slice(-scale) : "";
    return `${negative ? "-" : ""}${whole}${scale > 0 ? `,${fraction}` : ""}`;
  }

  const raw = String(value).trim();
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error(`Valor decimal inválido: ${raw}`);
  }

  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [wholeRaw, fractionRaw = ""] = unsigned.split(".");
  const significantExcess = fractionRaw.slice(scale);
  if (significantExcess && /[^0]/.test(significantExcess)) {
    throw new Error(`Valor decimal ${raw} excede ${scale} casas; quantize na regra de origem.`);
  }
  const fraction = `${fractionRaw.slice(0, scale)}${"0".repeat(scale)}`.slice(0, scale);
  const whole = BigInt(wholeRaw || "0").toString();
  return `${negative ? "-" : ""}${whole}${scale > 0 ? `,${fraction}` : ""}`;
}

function formatField(value: EfdRecord["values"][string], definition: EfdFieldDefinition): string {
  if (value === null || value === undefined || value === "") return "";
  if (definition.type === "decimal") {
    return canonicalDecimal(value as EfdFieldPrimitive, definition.scale ?? 2);
  }
  if (definition.type === "integer") {
    const raw = String(value).trim();
    if (!/^-?\d+$/.test(raw)) throw new Error(`Inteiro inválido em ${definition.name}.`);
    return BigInt(raw).toString();
  }
  if (definition.type === "date") {
    if (typeof value === "object") return formatEfdDate(value);
    const raw = String(value).trim();
    if (/^\d{8}$/.test(raw)) return raw;
    return formatEfdDate(raw);
  }
  const text = sanitizeEfdText(value);
  return definition.maxLength ? text.slice(0, definition.maxLength) : text;
}

export function serializeEfdRecord(record: EfdRecord, layout: EfdLayout): string {
  const definition = layout.records.get(record.code);
  if (!definition) throw new Error(`Registro ${record.code} não existe no leiaute ${layout.code}.`);
  const fields = definition.fields.map((field) => formatField(record.values[field.name], field));
  return `|${record.code}|${fields.join("|")}|`;
}

export function countEfdRecords(records: readonly EfdRecord[]): Record<string, number> {
  return records.reduce<Record<string, number>>((counts, record) => {
    counts[record.code] = (counts[record.code] ?? 0) + 1;
    return counts;
  }, {});
}

function closingCodeForBlock(block: string): string {
  return block === "0" ? "0990" : block === "1" ? "1990" : `${block}990`;
}

function closingFieldForBlock(block: string): string {
  return block === "0" ? "QTD_LIN_0" : block === "1" ? "QTD_LIN_1" : `QTD_LIN_${block}`;
}

/** Recalcula encerramentos dos blocos já presentes, sem inventar blocos ausentes. */
export function recalculateBlockClosures(records: readonly EfdRecord[]): EfdRecord[] {
  const withoutNine = records.filter((record) => record.code[0] !== "9");
  const blockNine = records.filter((record) => record.code[0] === "9");
  const recalculated = withoutNine.map((record) => {
    const block = record.code[0];
    if (record.code !== closingCodeForBlock(block)) return record;
    const quantity = withoutNine.filter((candidate) => candidate.code[0] === block).length;
    return { ...record, values: { ...record.values, [closingFieldForBlock(block)]: quantity } };
  });
  return [...recalculated, ...blockNine];
}

/**
 * Gera o Bloco 9 por ponto fixo: o próprio 9900, 9990 e 9999 entram nos
 * contadores e na quantidade total de linhas.
 */
export function appendBlockNine(records: readonly EfdRecord[]): EfdRecord[] {
  const withoutNine = records.filter((record) => record.code[0] !== "9");
  const body = recalculateBlockClosures(withoutNine);
  const codes = new Set(body.map((record) => record.code));
  codes.add("9001");
  codes.add("9900");
  codes.add("9990");
  codes.add("9999");

  const countBeforeNine = countEfdRecords(body);
  const orderedCodes = Array.from(codes).sort((left, right) => left.localeCompare(right, "en"));
  const blockNineCount = 1 + orderedCodes.length + 1 + 1;
  const totalLines = body.length + blockNineCount;

  const blockNine: EfdRecord[] = [
    { code: "9001", values: { IND_MOV: "0" } },
    ...orderedCodes.map((code) => ({
      code: "9900",
      values: {
        REG_BLC: code,
        QTD_REG_BLC: code === "9900" ? orderedCodes.length : (countBeforeNine[code] ?? 1),
      },
    })),
    { code: "9990", values: { QTD_LIN_9: blockNineCount } },
    { code: "9999", values: { QTD_LIN: totalLines } },
  ];

  return [...body, ...blockNine];
}

export function encodeEfdLatin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes[index] = code <= 255 ? code : 63;
  }
  return bytes;
}

export function serializeEfd(
  records: readonly EfdRecord[],
  layout: EfdLayout,
): SerializedEfd {
  const completed = appendBlockNine(records);
  const text = `${completed.map((record) => serializeEfdRecord(record, layout)).join("\r\n")}\r\n`;
  return {
    layout: layout.code,
    text,
    bytes: encodeEfdLatin1(text),
    lineCount: completed.length,
    recordCounts: countEfdRecords(completed),
  };
}
