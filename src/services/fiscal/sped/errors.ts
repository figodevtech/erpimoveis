export class SpedServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = "SPED_ERROR",
  ) {
    super(message);
    this.name = "SpedServiceError";
  }
}

export function throwIfSupabaseError(error: { message?: string; code?: string } | null) {
  if (!error) return;
  const status = error.code === "P0002" ? 404 : error.code === "40001" || error.code === "23505" ? 409 : 500;
  throw new SpedServiceError(error.message || "Falha de persistência do SPED.", status, error.code || "DATABASE_ERROR");
}
