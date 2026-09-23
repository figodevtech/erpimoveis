// Chamada da tela para registrar "estou ciente" no servidor. A ciência só vale
// depois que o servidor a grava (nfe_ciencia_aviso); marcar o checkbox na tela
// é estado local até esta chamada.

import type { PedidoCiencia } from "./issuesFiscais";

export type AlvoCiencia =
  | { tipo: "AVULSA"; id?: number | null }
  | { tipo: "OS" | "VENDA"; id: number; modelo?: number }
  | { tipo: "ENTRADA" | "SAIDA"; id: number };

export type RespostaCiencia =
  | {
      ok: true;
      registradas: PedidoCiencia[];
      jaRegistradas: PedidoCiencia[];
      recusadas: Array<PedidoCiencia & { motivo: string }>;
    }
  | {
      ok: false;
      status: number;
      message?: string;
      errors?: Array<{ step?: string; itemIndex?: number; field?: string; message: string; code?: string }>;
    };

/** Nova sessão de emissão: agrupa as ciências até o rascunho ser salvo. */
export function novoEscopoCiencia(): string {
  return globalThis.crypto.randomUUID();
}

export async function registrarCienciaNoServidor(input: {
  alvo: AlvoCiencia;
  payload: Record<string, unknown>;
  cienciaEscopo: string;
  pedidos: PedidoCiencia[];
}): Promise<RespostaCiencia> {
  const response = await fetch("/api/fiscal/nfe/ciencias", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = (await response.json().catch(() => null)) as Record<string, any> | null;
  if (response.ok && json?.ok) {
    return {
      ok: true,
      registradas: json.registradas ?? [],
      jaRegistradas: json.jaRegistradas ?? [],
      recusadas: json.recusadas ?? [],
    };
  }
  return {
    ok: false,
    status: response.status,
    message: json?.message ?? json?.detalhe,
    errors: Array.isArray(json?.errors) ? json.errors : undefined,
  };
}
