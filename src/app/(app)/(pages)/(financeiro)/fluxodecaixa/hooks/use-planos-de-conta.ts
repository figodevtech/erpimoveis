"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Plano_de_conta, Plano_de_conta_grupo } from "../types";

export function usePlanosDeConta(enabled = true) {
  const [planosDeConta, setPlanosDeConta] = useState<Plano_de_conta[]>([]);
  const [loadingPlanos, setLoadingPlanos] = useState(false);
  const [errorPlanos, setErrorPlanos] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
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

    const timer = window.setTimeout(() => void fetchPlanos(), 0);
    return () => window.clearTimeout(timer);
  }, [enabled]);

  const gruposPlanosDeConta = useMemo(() => {
    const groups = new Map<number, { grupo: Plano_de_conta_grupo; planos: Plano_de_conta[] }>();
    planosDeConta.forEach((plano) => {
      const grupo = plano.grupo;
      if (!grupo?.id) return;
      const current = groups.get(grupo.id) ?? { grupo, planos: [] };
      current.planos.push(plano);
      groups.set(grupo.id, current);
    });
    const compareCode = (first?: string | null, second?: string | null) =>
      String(first ?? "").localeCompare(String(second ?? ""), "pt-BR", { numeric: true, sensitivity: "base" });
    return Array.from(groups.values())
      .map((group) => ({ ...group, planos: group.planos.sort((a, b) => compareCode(a.codigo, b.codigo)) }))
      .sort((a, b) => compareCode(a.grupo.codigo, b.grupo.codigo));
  }, [planosDeConta]);

  return { planosDeConta, gruposPlanosDeConta, loadingPlanos, errorPlanos };
}
