// Compartilha somente uma leitura em andamento, sem persistir respostas.
// Cada nova leitura apos a conclusao volta a consultar o servidor.
import type { Config } from "@/app/(app)/(pages)/type";

let pending: Promise<{ config?: Config }> | undefined;

export function requestConfig(): Promise<{ config?: Config }> {
  if (!pending) {
    pending = (async () => {
      const response = await fetch("/api/config", { cache: "no-store" });
      if (!response.ok) throw new Error(`Falha ao buscar configuracao: ${response.status}`);
      return response.json() as Promise<{ config?: Config }>;
    })().finally(() => { pending = undefined; });
  }
  return pending;
}
