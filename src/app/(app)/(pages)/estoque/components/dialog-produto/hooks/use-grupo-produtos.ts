"use client";

import { useEffect, useState } from "react";
import axios from "axios";

export type GrupoFromApi = {
  id: number;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  exibirPdv: boolean;
};

export function useGruposProduto() {
  const [grupos, setGrupos] = useState<GrupoFromApi[]>([]);
  const [loadingGrupos, setLoadingGrupos] = useState(false);
  const [errorGrupos, setErrorGrupos] = useState<string | null>(null);

  useEffect(() => {
    const fetchUnidades = async () => {
      try {
        setLoadingGrupos(true);
        setErrorGrupos(null);

        const res = await axios.get("/api/tipos/grupos-produto");
        const items: GrupoFromApi[] = res.data?.items ?? [];
        setGrupos(items.filter((u) => u.ativo));
      } catch (err) {
        console.error("Erro ao carregar grupos:", err);
        setErrorGrupos("Erro ao carregar grupos");
      } finally {
        setLoadingGrupos(false);
      }
    };

    fetchUnidades();
  }, []);

  return { grupos, loadingGrupos, errorGrupos };
}
