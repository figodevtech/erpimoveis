import { useCallback, useEffect, useState } from "react";

type CountsResponse = {
  countsByStatus?: Record<string, number>;
  total?: number;
  disponiveis?: number;
  ocupados?: number;
};

export default function useImoveisStatusCounter(opts?: { auto?: boolean }) {
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [loadingStatusCounter, setLoadingStatusCounter] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalImoveis, setTotalImoveis] = useState(0);
  const [disponiveis, setDisponiveis] = useState(0);
  const [ocupados, setOcupados] = useState(0);

  const fetchStatusCounts = useCallback(async () => {
    setLoadingStatusCounter(true);
    setError(null);
    try {
      const response = await fetch("/api/imoveis/status-counter", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          `Erro ao buscar contagem de status: ${response.status} ${response.statusText}`
        );
      }
      const data: CountsResponse = await response.json();
      setStatusCounts(data.countsByStatus ?? {});
      setTotalImoveis(data.total ?? 0);
      setDisponiveis(data.disponiveis ?? 0);
      setOcupados(data.ocupados ?? 0);
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
    totalImoveis,
    disponiveis,
    ocupados,
    loadingStatusCounter,
    error,
    fetchStatusCounts,
  };
}

