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
  const status = {
    P0002: 404,
    "40001": 409,
    "23505": 409,
    "55000": 409,
    "23514": 422,
    "23503": 422,
    "22023": 400,
  }[error.code ?? ""] ?? 500;
  throw new SpedServiceError(error.message || "Falha de persistência do SPED.", status, error.code || "DATABASE_ERROR");
}
