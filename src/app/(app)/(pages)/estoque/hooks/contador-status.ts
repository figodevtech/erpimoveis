import { useCallback, useEffect, useMemo, useState } from "react";

type CountsResponse = {
  countsByStatus: Record<string, number>;
  totalProducts: number;
  // raw?: { status: string | null; count: number }[];
};

export default function useContadorStatus(opts?: { auto?: boolean }) {
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [loadingStatusCounter, setLoadingStatusCounter] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalProducts, setTotalProducts] = useState(0);

  const fetchStatusCounts = useCallback(async () => {
    setLoadingStatusCounter(true);
    setError(null);
    try {
      const response = await fetch("/api/products/status-counter", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          `Erro ao buscar contagem de produtos: ${response.status} ${response.statusText}`
        );
      }
      const data: CountsResponse = await response.json();
      setStatusCounts(data.countsByStatus ?? {});
      setTotalProducts(data.totalProducts ?? 0);
    } catch (err: any) {
      setError(err?.message || "Erro desconhecido");
    } finally {
      setLoadingStatusCounter(false);
    }
  }, []);

  // 🔄 auto fetch por padrão
  useEffect(() => {
    // só NÃO busca se o dev passar auto: false
    if (opts?.auto !== false) {
      const timer = window.setTimeout(() => void fetchStatusCounts(), 0);
      return () => window.clearTimeout(timer);
    }
  }, [opts?.auto, fetchStatusCounts]);

  const total = useMemo(
    () => Object.values(statusCounts).reduce((a, b) => a + b, 0),
    [statusCounts]
  );
  const asArray = useMemo(
    () => Object.entries(statusCounts).map(([status, count]) => ({ status, count })),
    [statusCounts]
  );

  return {
    statusCounts,
    total,
    totalProducts,
    asArray,
    loadingStatusCounter,
    error,
    fetchStatusCounts, // ainda pode chamar manualmente
  };
}
