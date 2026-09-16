export type FiscalDateValue = {
  /** Data civil da fonte fiscal, sem conversão de fuso. */
  civilDate: string;
  /** Representação lexical recebida da fonte. */
  originalText?: string;
  /** `Z` ou offset lexical `+/-HH:mm`, quando presente. */
  originalOffset?: string;
  /** Instante correspondente, somente quando a fonte informou offset. */
  instantUtc?: string;
  /** Fuso usado apenas como contexto para fontes sem offset. */
  timezoneIana?: string;
};

const DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function isValidCivilDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

export function isValidIanaTimezone(value: unknown): value is string {
  const timezone = String(value ?? "").trim();
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: timezone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/**
 * Lê uma data fiscal preservando a data civil que aparece no documento.
 * Nunca deriva `civilDate` de `Date`, evitando deslocamento de competência.
 */
export function parseFiscalDate(
  value: unknown,
  options: { timezoneIana?: string } = {},
): FiscalDateValue | null {
  const originalText = String(value ?? "").trim();
  const match = DATE_TIME_PATTERN.exec(originalText);
  if (!match) return null;

  const civilDate = `${match[1]}-${match[2]}-${match[3]}`;
  if (!isValidCivilDate(civilDate)) return null;

  const timezoneIana = options.timezoneIana?.trim();
  if (timezoneIana && !isValidIanaTimezone(timezoneIana)) return null;

  let originalOffset = match[8];
  if (originalOffset && originalOffset !== "Z" && !originalOffset.includes(":")) {
    originalOffset = `${originalOffset.slice(0, 3)}:${originalOffset.slice(3)}`;
  }

  let instantUtc: string | undefined;
  if (match[4] && originalOffset) {
    const normalized = `${civilDate}T${match[4]}:${match[5]}:${match[6] ?? "00"}${
      match[7] ? `.${match[7]}` : ""
    }${originalOffset}`;
    const instant = new Date(normalized);
    if (Number.isNaN(instant.getTime())) return null;
    instantUtc = instant.toISOString();
  }

  return {
    civilDate,
    originalText,
    ...(originalOffset ? { originalOffset } : {}),
    ...(instantUtc ? { instantUtc } : {}),
    ...(timezoneIana ? { timezoneIana } : {}),
  };
}

export function formatEfdDate(value: string | FiscalDateValue): string {
  const civilDate = typeof value === "string" ? value : value.civilDate;
  if (!isValidCivilDate(civilDate)) throw new Error(`Data civil inválida: ${civilDate}`);
  const [year, month, day] = civilDate.split("-");
  return `${day}${month}${year}`;
}

export function competenceFromCivilDate(civilDate: string): string | null {
  return isValidCivilDate(civilDate) ? civilDate.slice(0, 7) : null;
}

export function isCivilDateInCompetence(civilDate: string, competence: string): boolean {
  return competenceFromCivilDate(civilDate) === competence;
}

export function parseCompetence(competence: string): { start: string; year: number; month: number } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(competence);
  if (!match) throw new Error("Competência deve usar AAAA-MM com mês entre 01 e 12.");
  return { start: `${competence}-01`, year: Number(match[1]), month: Number(match[2]) };
}

export function endOfCompetence(competence: string): string {
  const { year, month } = parseCompetence(competence);
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${competence}-${String(day).padStart(2, "0")}`;
}
