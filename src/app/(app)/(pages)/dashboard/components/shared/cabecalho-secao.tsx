"use client";

import * as React from "react";

export type CabecalhoSecaoProps = {
  titulo: string;
  /** O recorte de tempo do bloco: as datas do filtro, ou o aviso de que ele não segue o filtro. */
  nota?: string;
};

/** Nomeia um bloco do dashboard e diz de quando são os números dele. */
export default function CabecalhoSecao({ titulo, nota }: CabecalhoSecaoProps) {
  return (
    <div className="flex items-center gap-2">
      <p className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{titulo}</p>
      {nota ? <span className="min-w-0 truncate text-[11px] text-muted-foreground/70">· {nota}</span> : null}
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}
