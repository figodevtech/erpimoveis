"use client";

import { useEffect, useState } from "react";
import axios from "axios";

export type CategoriaFromApi = {
  id: number;
  nome: string;
  descricao: string | null;
  icone: string;
  codigo_sistema: string | null;
  ativo: boolean;
};

export function useCategoriasTransacao(enabled = true) {
  const [categorias, setCategorias] = useState<CategoriaFromApi[]>([]);
  const [loadingCategorias, setLoadingCategorias] = useState(false);
  const [errorCategorias, setErrorCategorias] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const fetchUnidades = async () => {
      try {
        setLoadingCategorias(true);
        setErrorCategorias(null);

        const res = await axios.get("/api/tipos/categorias-transacao?ativo=true");
        const items: CategoriaFromApi[] = res.data?.items ?? [];
        setCategorias(items.filter((u) => u.ativo));
      } catch (err) {
        console.error("Erro ao carregar categorias:", err);
        setErrorCategorias("Erro ao carregar categorias");
      } finally {
        setLoadingCategorias(false);
      }
    };

    const timer = window.setTimeout(() => void fetchUnidades(), 0);
    return () => window.clearTimeout(timer);
  }, [enabled]);

  return { categorias, loadingCategorias, errorCategorias };
}
