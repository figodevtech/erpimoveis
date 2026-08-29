import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const TRANSACAO_ANEXOS_BUCKET = "transacao_anexos";
export const MAX_ANEXOS_POR_TRANSACAO = 10;
export const MAX_TRANSACAO_ANEXO_SIZE = 10 * 1024 * 1024;
export const TRANSACAO_ANEXO_URL_TTL_SECONDS = 60 * 60;

export type TransacaoAnexoRow = {
  id: number;
  transacao_id: number;
  nome: string;
  tipo: string;
  tamanho: number;
  path: string;
  descricao: string | null;
  created_by: string | null;
  created_at: string;
};

export function parsePositiveId(value: unknown, label: string) {
  const id = Number(String(value ?? "").trim());
  if (!Number.isSafeInteger(id) || id <= 0) {
    const error = new Error(`${label} inválido.`);
    (error as Error & { statusCode?: number }).statusCode = 400;
    throw error;
  }
  return id;
}

export function sanitizeAttachmentName(name: string) {
  return (name || "anexo")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 120);
}

export function isSupportedAttachment(file: File) {
  const type = String(file.type || "").toLowerCase();
  return type === "application/pdf" || ["image/jpeg", "image/png", "image/webp"].includes(type);
}

export async function signedAttachmentUrl(path: string) {
  const { data, error } = await supabaseAdmin.storage
    .from(TRANSACAO_ANEXOS_BUCKET)
    .createSignedUrl(path, TRANSACAO_ANEXO_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    throw error ?? new Error("Não foi possível liberar o acesso ao anexo.");
  }
  return data.signedUrl;
}

export async function attachmentWithSignedUrl(row: TransacaoAnexoRow) {
  const { path, ...metadata } = row;
  return { ...metadata, url: await signedAttachmentUrl(path) };
}

/**
 * Resolve o autor somente quando a sessão possui uma linha correspondente em
 * `usuario`. Logins externos podem ter UUID válido sem esse cadastro, e mandar
 * esse UUID diretamente quebraria a FK do anexo.
 */
export async function existingUserId(value: unknown) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) return null;

  const { data, error } = await supabaseAdmin
    .from("usuario")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

/**
 * Limpeza posterior a uma exclusão física. A FK elimina os metadados, mas o
 * Postgres não consegue apagar o objeto correspondente do Supabase Storage.
 */
export async function removeAttachmentObjects(paths: string[]) {
  if (paths.length === 0) return;
  const { error } = await supabaseAdmin.storage
    .from(TRANSACAO_ANEXOS_BUCKET)
    .remove(paths);
  if (error) throw error;
}

export async function attachmentPathsForTransactions(transactionIds: Array<number | string>) {
  if (transactionIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("transacao_anexo")
    .select("path")
    .in("transacao_id", transactionIds);

  // Compatibilidade durante o deploy: a versão nova da aplicação pode subir
  // instantes antes da migration em um dos bancos dos clientes.
  if (error?.code === "42P01") return [];
  if (error) throw error;
  return (data ?? []).map((item) => item.path).filter(Boolean) as string[];
}
