"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

import CabecalhoSecao from "./cabecalho-secao";

export type FaixaKpisProps = {
  titulo: string;
  /** O recorte de tempo dos números da faixa: as datas do filtro, ou o aviso de que ela não segue o filtro. */
  nota?: string;
  carregando?: boolean;
  className?: string;
  children: React.ReactNode;
};

/** Agrupa os KPIs por recorte de tempo — no mobile vira uma coluna, na mesma ordem. */
export default function FaixaKpis({ titulo, nota, carregando, className, children }: FaixaKpisProps) {
  return (
    <section className="space-y-2">
      <CabecalhoSecao titulo={titulo} nota={nota} />
      <div
        className={cn("dashboard-kpi-strip grid grid-cols-1 gap-2", className)}
        data-loading={carregando}
        aria-busy={carregando}
      >
        {children}
      </div>
    </section>
  );
}
