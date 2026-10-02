"use client";

import { supabaseBrowser } from "@/lib/supabase-browser";

type Payload = Record<string, unknown>;

async function lerPayload(response: Response): Promise<Payload> {
  return response.json().catch(() => ({}));
}

function mensagemDe(payload: Payload, response: Response, fallback: string) {
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  if (response.status === 413) return "Arquivo muito grande para envio.";
  return fallback;
}

/**
 * Sobe o arquivo direto ao Storage e só depois registra o anexo, para que o
 * corpo da requisição à API nunca carregue o arquivo (ver
 * `@/lib/anexos/envio-direto`). `rota` é a coleção de anexos do registro,
 * como `/api/ordens/12/anexos`. Devolve o JSON do registro.
 */
export async function enviarAnexo(
  rota: string,
  file: File,
  campos: Record<string, string | null | undefined> = {},
): Promise<Payload> {
  const emissao = await fetch(`${rota}/envio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome: file.name, tipo: file.type, tamanho: file.size }),
  });
  const ticket = await lerPayload(emissao);
  if (!emissao.ok) throw new Error(mensagemDe(ticket, emissao, "Não foi possível preparar o envio."));

  const { bucket, path, token } = ticket;
  if (typeof bucket !== "string" || typeof path !== "string" || typeof token !== "string") {
    throw new Error("O servidor não liberou o envio do arquivo.");
  }

  const { error } = await supabaseBrowser.storage
    .from(bucket)
    .uploadToSignedUrl(path, token, file, { contentType: file.type || undefined });
  if (error) throw new Error(`Falha ao enviar o arquivo: ${error.message}`);

  const registro = await fetch(rota, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...campos, nome: file.name, path }),
  });
  const payload = await lerPayload(registro);
  if (!registro.ok) throw new Error(mensagemDe(payload, registro, "Erro ao anexar arquivo."));
  return payload;
}
