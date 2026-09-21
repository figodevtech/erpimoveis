/** Extract schema identifiers, never record values, SQL, stacks or arbitrary hints. */
export function databaseErrorDetail(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const raw = error as Record<string, unknown>;
  const message = typeof raw.message === "string" ? raw.message.slice(0, 2048) : "";
  const identifier = '[a-zA-Z_][a-zA-Z0-9_]{0,62}(?:\\.[a-zA-Z_][a-zA-Z0-9_]{0,62})?';
  const column = message.match(new RegExp(`^column "?(${identifier})"? does not exist$`));
  if (column) return { reason: "MISSING_COLUMN" as const, column: column[1] };
  const relation = message.match(new RegExp(`^relation "(${identifier})" does not exist$`));
  if (relation) return { reason: "MISSING_RELATION" as const, table: relation[1] };
  const cache = message.match(new RegExp(`^Could not find the '(${identifier})' column of '(${identifier})' in the schema cache$`));
  if (cache) return { reason: "MISSING_COLUMN" as const, column: cache[1], table: cache[2] };
  const required = message.match(new RegExp(`^null value in column "(${identifier})" of relation "(${identifier})" violates not-null constraint$`));
  if (required) return { reason: "NOT_NULL" as const, column: required[1], table: required[2] };
  // The offending value can be a document number. Keep only the type.
  if (raw.code === "22003" || /out of range for type (?:integer|bigint|smallint)/i.test(message)) return { reason: "NUMERIC_OVERFLOW" as const };
  if (raw.code === "23505") return { reason: "UNIQUE_VIOLATION" as const };
  if (raw.code === "23503") return { reason: "FOREIGN_KEY_VIOLATION" as const };
  if (raw.code === "57014") return { reason: "QUERY_CANCELED" as const };
  return undefined;
}
