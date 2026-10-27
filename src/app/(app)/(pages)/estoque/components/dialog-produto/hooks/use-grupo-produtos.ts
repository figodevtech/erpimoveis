"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";

export type GrupoFromApi = {
  id: number;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  exibirPdv: boolean;
};

export function useGruposProduto(enabled = true) {
  const [grupos, setGrupos] = useState<GrupoFromApi[]>([]);
  const [loadingGrupos, setLoadingGrupos] = useState(false);
  const [errorGrupos, setErrorGrupos] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
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

    const timer = window.setTimeout(() => void fetchUnidades(), 0);
    return () => window.clearTimeout(timer);
  }, [enabled]);

  // Grupo cadastrado na hora (ex.: pelo "+" do cadastro de produto) entra na
  // lista sem buscar todos de novo.
  const adicionarGrupo = useCallback((grupo: GrupoFromApi) => {
    if (!grupo.ativo) return;
    setGrupos((atual) =>
      [...atual.filter((g) => g.id !== grupo.id), grupo].sort((a, b) =>
        a.nome.localeCompare(b.nome, "pt-BR"),
      ),
    );
  }, []);

  return { grupos, loadingGrupos, errorGrupos, adicionarGrupo };
}
