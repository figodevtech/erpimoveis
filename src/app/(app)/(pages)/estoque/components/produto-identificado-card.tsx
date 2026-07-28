"use client";

import type { Produto } from "../types";
import { Edit } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  produto: Produto;
  onEdit?: () => void;
};

function formatCurrency(value?: number) {
  if (value == null) return "-";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function ProdutoIdentificadoCard({ produto, onEdit }: Props) {
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

      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-medium">{produto.titulo || "Produto sem nome"}</div>
            <div className="text-xs text-muted-foreground">Produto #{produto.id ?? "-"}</div>
          </div>
          {onEdit ? (
            <Button type="button" size="sm" variant="outline" className="shrink-0 gap-2" onClick={onEdit}>
              <Edit className="h-3.5 w-3.5" />
              Editar produto
            </Button>
          ) : null}
        </div>

        {produto.descricao ? <p className="text-xs text-muted-foreground">{produto.descricao}</p> : null}

        <div className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
          <div><span className="text-muted-foreground">Código de barras:</span> {produto.codigobarras || "-"}</div>
          <div><span className="text-muted-foreground">Referência:</span> {produto.referencia || "-"}</div>
          <div><span className="text-muted-foreground">Etiqueta:</span> {produto.etiqueta || "-"}</div>
          <div><span className="text-muted-foreground">Local:</span> {produto.local || "-"}</div>
          <div><span className="text-muted-foreground">Fabricante:</span> {produto.fabricante || "-"}</div>
          <div><span className="text-muted-foreground">Unidade:</span> {produto.unidade || "-"}</div>
          <div><span className="text-muted-foreground">Estoque:</span> {produto.estoque ?? 0}</div>
          <div><span className="text-muted-foreground">Estoque mínimo:</span> {produto.estoqueminimo ?? 0}</div>
          <div><span className="text-muted-foreground">Preço de venda:</span> {formatCurrency(produto.precovenda)}</div>
          <div><span className="text-muted-foreground">Status:</span> {produto.status_estoque || "-"}</div>
        </div>
      </div>
    </div>
  );
}
