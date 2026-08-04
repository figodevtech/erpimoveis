"use client";

import { useEffect, useState } from "react";
import axios from "axios";

import type { Banco } from "../types";

/**
 * Contas bancarias ativas. Estava duplicado em cada dialog que precisava da
 * lista; centralizar tambem uniformiza o tratamento de erro, que antes era um
 * `catch {}` silencioso e deixava o combobox vazio sem explicacao.
 */
export function useBancos() {
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [loadingBancos, setLoadingBancos] = useState(true);
  const [errorBancos, setErrorBancos] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;

    async function carregar() {
      try {
        setLoadingBancos(true);
        setErrorBancos(null);
        const response = await axios.get("/api/banks");
        if (ativo) setBancos(response.data?.data ?? []);
      } catch (error) {
        console.error("Erro ao carregar bancos:", error);
        if (ativo) setErrorBancos("Não foi possível carregar os bancos");
      } finally {
        if (ativo) setLoadingBancos(false);
      }
    }

    void carregar();

    return () => {
      ativo = false;
    };
  }, []);

  return { bancos, loadingBancos, errorBancos };
}
