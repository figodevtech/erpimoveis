"use client";

import { useEffect, useState } from "react";
import axios from "axios";

import type { Centro_custo } from "../types";

export function useCentrosCusto(enabled = true) {
  const [centrosCusto, setCentrosCusto] = useState<Centro_custo[]>([]);
  const [loadingCentrosCusto, setLoadingCentrosCusto] = useState(false);
  const [errorCentrosCusto, setErrorCentrosCusto] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    async function load() {
      try {
        setLoadingCentrosCusto(true);
        setErrorCentrosCusto(null);
        const response = await axios.get("/api/tipos/centros-de-custo?ativo=true");
        const items: Centro_custo[] = response.data?.items ?? [];
        setCentrosCusto(items.filter((item) => item.ativo));
      } catch (error) {
        console.error("Erro ao carregar centros de custo:", error);
        setErrorCentrosCusto("Erro ao carregar centros de custo");
      } finally {
        setLoadingCentrosCusto(false);
      }
    }
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [enabled]);

  return { centrosCusto, loadingCentrosCusto, errorCentrosCusto };
}
