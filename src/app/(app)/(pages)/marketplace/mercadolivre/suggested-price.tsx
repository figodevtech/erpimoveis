"use client";

import { useEffect, useState } from "react";

type PriceLookup = { price: number | null; expires: number };

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, PriceLookup>();
const pending = new Map<string, Promise<number | null>>();

async function loadSuggestedPrice(title: string): Promise<number | null> {
  const key = title.trim().replace(/\s+/g, " ").toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.price;

  const ongoing = pending.get(key);
  if (ongoing) return ongoing;

  const task = (async () => {
    try {
      const response = await fetch(
        `/api/integracoes/mercadolivre/pricing/suggest?q=${encodeURIComponent(title.trim())}`,
        { cache: "no-store" },
      );
      if (!response.ok) return null;
      const result: unknown = await response.json();
      if (!result || typeof result !== "object") return null;
      const price = Number((result as { averagePrice?: unknown }).averagePrice);
      return Number.isFinite(price) && price > 0 ? price : null;
    } catch {
      return null;
    }
  })();

  pending.set(key, task);
  try {
    const price = await task;
    cache.set(key, { price, expires: Date.now() + (price === null ? 30_000 : CACHE_MS) });
    return price;
  } finally {
    pending.delete(key);
  }
}

/**
 * Apenas exibe a média obtida da busca pública, sem ação de aplicar preço.
 * O preço do anúncio e o preço do produto no ERP jamais são alterados.
 */
export function MercadoLivreSuggestedPrice({
  title,
  active,
}: {
  title: string;
  active: boolean;
}) {
  const [state, setState] = useState<{ title: string; price: number | null; loading: boolean }>({
    title: "",
    price: null,
    loading: true,
  });

  const normalizedTitle = title.trim().replace(/\s+/g, " ");
  useEffect(() => {
    if (!active || normalizedTitle.length < 3) return;
    let disposed = false;
    const timer = setTimeout(async () => {
      const price = await loadSuggestedPrice(normalizedTitle);
      if (!disposed) setState({ title: normalizedTitle, price, loading: false });
    }, 600);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [active, normalizedTitle]);

  if (!active) return null;
  if (normalizedTitle.length < 3) {
    return <p className="text-xs text-muted-foreground">Não encontrado</p>;
  }

  if (state.title !== normalizedTitle || state.loading) {
    return <p className="text-xs text-muted-foreground" aria-label="Consultando preço sugerido">Preço sugerido: ...</p>;
  }

  return (
    <p className="text-xs text-muted-foreground" aria-live="polite">
      {state.price === null
        ? "Não encontrado"
        : `Preço sugerido: ${state.price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`}
    </p>
  );
}
