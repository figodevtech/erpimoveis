import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ErroDeAnexo } from "@/lib/anexos/envio-direto";

export type Params = { id: string };

export const BUCKET = "os_anexos";
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_ANEXOS_POR_OS = 10;

export function prefixoDaOs(osId: number) {
  return `os/${osId}/anexos/`;
}

export async function ensureBucket() {
  const current = await supabaseAdmin.storage.getBucket(BUCKET);
  if (!current.error) return;

  const created = await supabaseAdmin.storage.createBucket(BUCKET, { public: true });
  if (created.error && !created.error.message.toLowerCase().includes("already exists")) {
    throw created.error;
  }
}

export async function parseId(context: { params: Promise<Params> }) {
  const { id } = await context.params;
  const osId = Number(String(id ?? "").trim());
  if (!Number.isInteger(osId) || osId <= 0) {
    throw new ErroDeAnexo("ID da OS invalido.", 400);
  }
  return osId;
}

/** A OS existe e ainda aceita anexo. */
export async function exigirVagaNaOs(osId: number) {
  const os = await supabaseAdmin.from("ordemservico").select("id").eq("id", osId).maybeSingle();
  if (os.error) throw os.error;
  if (!os.data) throw new ErroDeAnexo("OS nao encontrada.", 404);

  const { count, error } = await supabaseAdmin
    .from("osanexo")
    .select("id", { count: "exact", head: true })
    .eq("ordemservicoid", osId);
  if (error) throw error;
  if ((count ?? 0) >= MAX_ANEXOS_POR_OS) {
    throw new ErroDeAnexo(`Limite de ${MAX_ANEXOS_POR_OS} anexos por OS atingido.`, 400);
  }
}

export function respostaDeErro(error: any, fallback: string) {
  const status = error instanceof ErroDeAnexo ? error.statusCode : 500;
  return Response.json({ error: error?.message ?? fallback }, { status });
}
