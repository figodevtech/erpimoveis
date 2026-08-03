"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "@/lib/toast";

/** Tipo de entrada cadastrado em Configurações > Tipos. */
export type TipoEntradaOption = { codigo: string; nome: string; exigeValor: boolean };

/**
 * Carrega os tipos de entrada ativos do escopo informado.
 * `enabled` evita buscar enquanto o dialog que consome ainda está fechado.
 */
export function useTiposEntrada(enabled: boolean, inventory: "produto" | "usoconsumo" = "produto") {
  const [tipos, setTipos] = useState<TipoEntradaOption[]>([]);
  const [loadingTipos, setLoadingTipos] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let ativo = true;
    const escopo = inventory === "usoconsumo" ? "USOCONSUMO" : "PRODUTO";

    // O setState fica dentro da cadeia de promise (e nao no corpo do efeito) para
    // nao disparar renders em cascata — regra react-hooks/set-state-in-effect.
    void Promise.resolve()
      .then(() => {
        if (!ativo) return null;
        setLoadingTipos(true);
        return axios.get(`/api/tipos/tipos-entrada?ativo=true&escopo=${escopo}`);
      })
      .then((response) => {
        if (!ativo || !response) return;
        setTipos(
          (response.data?.items ?? []).map((item: any) => ({
            codigo: String(item.codigo),
            nome: String(item.nome),
            exigeValor: item.exigeValor !== false,
          })),
        );
      })
      .catch(() => {
        if (ativo) toast.error("Não foi possível carregar os tipos de entrada.");
      })
      .finally(() => {
        if (ativo) setLoadingTipos(false);
      });
    return () => {
      ativo = false;
    };
  }, [enabled, inventory]);

  return { tipos, loadingTipos };
}
