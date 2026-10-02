import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ErroDeAnexo } from "@/lib/anexos/envio-direto";

export type Params = { id: string };

export const BUCKET = "venda_anexos";
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_ANEXOS_POR_VENDA = 5;

export function prefixoDaVenda(vendaId: number) {
  return `venda/${vendaId}/anexos/`;
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
  const vendaId = Number(String(id ?? "").trim());
  if (!Number.isInteger(vendaId) || vendaId <= 0) {
    throw new ErroDeAnexo("ID da venda inválido.", 400);
  }
  return vendaId;
}

/** A venda existe e ainda aceita anexo. */
export async function exigirVagaNaVenda(vendaId: number) {
  const venda = await supabaseAdmin.from("venda").select("id").eq("id", vendaId).maybeSingle();
  if (venda.error) throw venda.error;
  if (!venda.data) throw new ErroDeAnexo("Venda não encontrada.", 404);

  const { count, error } = await supabaseAdmin
    .from("vendaanexo")
    .select("id", { count: "exact", head: true })
    .eq("vendaid", vendaId);
  if (error) throw error;
  if ((count ?? 0) >= MAX_ANEXOS_POR_VENDA) {
    throw new ErroDeAnexo(`Limite de ${MAX_ANEXOS_POR_VENDA} anexos por venda atingido.`, 400);
  }
}

export function respostaDeErro(error: any, fallback: string) {
  const status = error instanceof ErroDeAnexo ? error.statusCode : 500;
  return Response.json({ error: error?.message ?? fallback }, { status });
}
