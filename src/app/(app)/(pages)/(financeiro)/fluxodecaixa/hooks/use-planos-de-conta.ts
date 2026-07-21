"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Plano_de_conta } from "../types";

export function usePlanosDeConta() {
  const [planosDeConta, setPlanosDeConta] = useState<Plano_de_conta[]>([]);
  const [loadingPlanos, setLoadingPlanos] = useState(false);
  const [errorPlanos, setErrorPlanos] = useState<string | null>(null);

  useEffect(() => {
    const fetchPlanos = async () => {
      try {
        setLoadingPlanos(true);
        setErrorPlanos(null);

        const res = await axios.get("/api/tipos/planos-de-conta?ativo=true");
        const items: Plano_de_conta[] = res.data?.items ?? [];
        setPlanosDeConta(items.filter((p) => p.ativo));
      } catch (err) {
        console.error("Erro ao carregar planos de conta:", err);
        setErrorPlanos("Erro ao carregar planos de conta");
      } finally {
        setLoadingPlanos(false);
      }
    };

    fetchPlanos();
  }, []);

  return { planosDeConta, loadingPlanos, errorPlanos };
}
