import { createTtlCache } from "./ttl-cache";

class NaoGuardar<T> {
  constructor(readonly value: T) {}
}

/**
 * Consulta compartilhada por chave: chamadas simultaneas dividem a mesma
 * leitura, e o resultado vale por `ttlMs` nesta instancia. So fica guardado o
 * que `keepIf` aprovar — resposta "indisponivel" e falha voltam para quem pediu
 * sem ocupar o cache. Sem dependencias de Node: roda no middleware (edge).
 */
export function createSharedLookup<T>({
  ttlMs,
  keepIf = () => true,
  maxEntries = 500,
  now,
}: {
  ttlMs: number;
  keepIf?: (value: T) => boolean;
  maxEntries?: number;
  now?: () => number;
}) {
  const cache = createTtlCache<string, T>({ ttlMs, maxEntries, now });

  return function lookup(key: string, loader: () => Promise<T>): Promise<T> {
    return cache
      .get(key, async () => {
        const value = await loader();
        if (!keepIf(value)) throw new NaoGuardar(value);
        return value;
      })
      .catch((error: unknown) => {
        if (error instanceof NaoGuardar) return error.value as T;
        throw error;
      });
  };
}
