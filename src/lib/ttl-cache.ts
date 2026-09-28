/**
 * Cache em memória com validade curta e dedupe de chamadas simultâneas.
 *
 * É otimização local da instância, nunca fonte de verdade: instância nova ou
 * entrada vencida simplesmente relê a origem. Guarda a promessa para que várias
 * chamadas ao mesmo tempo dividam uma única leitura, e tira do cache a promessa
 * que falhou antes de repassar o erro — nenhuma chamada seguinte herda uma
 * rejeição antiga.
 */
export type TtlCache<K, V> = {
  get(key: K, loader: () => Promise<V>, options?: { fresh?: boolean }): Promise<V>;
  invalidate(key: K): void;
  clear(): void;
  readonly size: number;
};

type Entry<V> = { promise: Promise<V>; expiresAt: number };

export function createTtlCache<K, V>({
  ttlMs,
  maxEntries = 500,
  now = Date.now,
}: {
  ttlMs: number;
  maxEntries?: number;
  now?: () => number;
}): TtlCache<K, V> {
  const entries = new Map<K, Entry<V>>();

  const prune = () => {
    if (entries.size <= maxEntries) return;
    const agora = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= agora) entries.delete(key);
    }
    // Ainda cheio: descarta as mais antigas (a Map preserva a ordem de inserção).
    for (const key of entries.keys()) {
      if (entries.size <= maxEntries) break;
      entries.delete(key);
    }
  };

  return {
    get(key, loader, options) {
      const cached = entries.get(key);
      if (!options?.fresh && cached && cached.expiresAt > now()) return cached.promise;

      const promise = loader();
      const entry: Entry<V> = { promise, expiresAt: now() + ttlMs };
      entries.set(key, entry);
      prune();

      return promise.catch((error: unknown) => {
        // Só apaga se ninguém gravou uma leitura mais nova nesse meio tempo.
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      });
    },
    invalidate(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}
