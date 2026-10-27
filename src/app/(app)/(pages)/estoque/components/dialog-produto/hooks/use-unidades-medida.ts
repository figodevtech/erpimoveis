"use client";

import { useEffect, useState } from "react";
import axios from "axios";

export type UnidadeFromApi = {
  id: number;
  sigla: string;
  descricao: string | null;
  ativo: boolean;
};

export function useUnidadesMedida(enabled = true) {
  const [unidades, setUnidades] = useState<UnidadeFromApi[]>([]);
  const [loadingUnidades, setLoadingUnidades] = useState(false);
  const [errorUnidades, setErrorUnidades] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const fetchUnidades = async () => {
      try {
        setLoadingUnidades(true);
        setErrorUnidades(null);

        const res = await axios.get("/api/tipos/unidades-medida");
        const items: UnidadeFromApi[] = res.data?.items ?? [];
        setUnidades(items.filter((u) => u.ativo));
      } catch (err) {
        console.error("Erro ao carregar unidades de medida:", err);
        setErrorUnidades("Erro ao carregar unidades de medida");
      } finally {
        setLoadingUnidades(false);
      }
    };

    fetchUnidades();
  }, [enabled]);

  return { unidades, loadingUnidades, errorUnidades };
}
