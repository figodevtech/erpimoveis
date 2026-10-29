import { useCallback, useEffect, useState } from "react";

type CountsResponse = {
  countsByStatus?: Record<string, number>;
  total?: number;
};

export default function useProprietariosStatusCounter(opts?: { auto?: boolean }) {
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [loadingStatusCounter, setLoadingStatusCounter] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalProprietarios, setTotalProprietarios] = useState(0);

  const fetchStatusCounts = useCallback(async () => {
    setLoadingStatusCounter(true);
    setError(null);
    try {
      const response = await fetch("/api/proprietarios/status-counter", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          `Erro ao buscar contagem de status: ${response.status} ${response.statusText}`
        );
      }
      const data: CountsResponse = await response.json();
      setStatusCounts(data.countsByStatus ?? {});
      setTotalProprietarios(data.total ?? 0);
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
    totalProprietarios,
    loadingStatusCounter,
    error,
    fetchStatusCounts,
  };
}

