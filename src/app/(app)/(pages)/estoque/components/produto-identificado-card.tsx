"use client";

import type { Produto } from "../types";

type Props = {
  produto: Produto;
};

export function ProdutoIdentificadoCard({ produto }: Props) {
  return (
    <div className="flex gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
      {produto.imgUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={produto.imgUrl}
          alt={produto.titulo || "Produto"}
          className="h-16 w-16 shrink-0 rounded-md border bg-background object-cover"
        />
      ) : (
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border bg-background px-2 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Sem foto
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{produto.titulo || "Produto sem nome"}</div>
        <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          <div>Codigo: {produto.codigobarras || "-"}</div>
          <div>Etiqueta: {produto.etiqueta || "-"}</div>
          <div>Local: {produto.local || "-"}</div>
        </div>
      </div>
    </div>
  );
}
