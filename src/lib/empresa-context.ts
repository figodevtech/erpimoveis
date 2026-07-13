import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function requireEmpresaId() {
  const { data: empresas, error: empresasError } = await supabaseAdmin
    .from("empresa")
    .select("id")
    .order("id", { ascending: true })
    .limit(2);
  if (empresasError) throw empresasError;

  if (!empresas?.length) throw httpError("Nenhuma empresa cadastrada nesta instalação.", 409);
  if (empresas.length > 1) {
    throw httpError("Esta instalação possui mais de uma empresa. O marketplace exige uma empresa única por banco de dados.", 409);
  }
  return Number(empresas[0].id);
}

export function errorStatus(error: unknown, fallback = 500) {
  const status = Number((error as any)?.statusCode ?? fallback);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : fallback;
}

function httpError(message: string, statusCode: number) {
  const error = new Error(message);
  (error as any).statusCode = statusCode;
  return error;
}
