import { useCallback, useEffect, useState } from "react";

type CountsResponse = {
  countsByStatus?: Record<string, number>;
  total?: number;
  ativas?: number;
  finalizadas?: number;
};

export default function useReservasStatusCounter(opts?: { auto?: boolean }) {
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [loadingStatusCounter, setLoadingStatusCounter] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalReservas, setTotalReservas] = useState(0);
  const [ativas, setAtivas] = useState(0);
  const [finalizadas, setFinalizadas] = useState(0);

  const fetchStatusCounts = useCallback(async () => {
    setLoadingStatusCounter(true);
    setError(null);
    try {
      const response = await fetch("/api/reservas/status-counter", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          `Erro ao buscar contagem de status: ${response.status} ${response.statusText}`
        );
      }
      const data: CountsResponse = await response.json();
      setStatusCounts(data.countsByStatus ?? {});
      setTotalReservas(data.total ?? 0);
      setAtivas(data.ativas ?? 0);
      setFinalizadas(data.finalizadas ?? 0);
    } catch (err: any) {
      setError(err?.message || "Erro desconhecido");
    } finally {
      setLoadingStatusCounter(false);
    }
  }, []);

  useEffect(() => {
    if (opts?.auto !== false) {
      const timer = window.setTimeout(() => void fetchStatusCounts(), 0);
      return () => window.clearTimeout(timer);
    }
  }, [opts?.auto, fetchStatusCounts]);

  return {
    statusCounts,
    totalReservas,
    ativas,
    finalizadas,
    loadingStatusCounter,
    error,
    fetchStatusCounts,
  };
}

