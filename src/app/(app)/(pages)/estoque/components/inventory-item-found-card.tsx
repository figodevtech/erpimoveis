"use client";

import {
  Barcode,
  Boxes,
  Hash,
  MapPin,
  PackageCheck,
  PackageSearch,
  Pencil,
  Tag,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  InventoryLabelItem,
  InventoryLabelKind,
  InventoryLabelMatchBy,
} from "@/lib/inventory-labels";

type InventoryItemFoundCardProps = {
  kind: InventoryLabelKind;
  item: InventoryLabelItem;
  matchBy?: InventoryLabelMatchBy;
  subtitle?: string;
  onEdit?: () => void;
};

function stockStatusMeta(status: string | null | undefined) {
  switch (status?.toUpperCase()) {
    case "OK":
      return {
        label: "Estoque OK",
        accent: "bg-emerald-500",
        badge:
          "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      };
    case "BAIXO":
      return {
        label: "Estoque baixo",
        accent: "bg-amber-500",
        badge:
          "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      };
    case "CRITICO":
      return {
        label: "Estoque crítico",
        accent: "bg-red-500",
        badge: "border-red-600/30 bg-red-500/10 text-red-700 dark:text-red-300",
      };
    case "SEM_ESTOQUE":
      return {
        label: "Sem estoque",
        accent: "bg-slate-500",
        badge:
          "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
      };
    default:
      return {
        label: "Status não informado",
        accent: "bg-muted-foreground",
        badge: "border-border bg-muted text-muted-foreground",
      };
  }
}

function formatQuantity(value: number | null | undefined) {
  const quantity = Number(value ?? 0);
  return Number.isFinite(quantity) ? quantity.toLocaleString("pt-BR") : "0";
}

function matchByLabel(matchBy: InventoryLabelMatchBy) {
  if (matchBy === "CODIGOBARRAS") return "Código de barras";
  if (matchBy === "AMBOS") return "Etiqueta e código de barras";
  return "Etiqueta";
}

export function InventoryItemFoundCard({
  kind,
  item,
  matchBy,
  subtitle = "Dados do estoque identificados",
  onEdit,
}: InventoryItemFoundCardProps) {
  const moduleName = kind === "PRODUTO" ? "Produto" : "Uso/consumo";
  const imageUrl = item.imgUrl || item.img_url;
  const status = stockStatusMeta(item.status_estoque);
  const itemName = item.titulo || `${moduleName} sem nome`;
  const unit = item.unidade ? ` ${item.unidade}` : "";
  const editLabel = kind === "PRODUTO" ? "Editar" : "Editar";

  return (
    <article
      aria-label={`${moduleName} identificado: ${itemName}`}
      className="relative overflow-hidden rounded-xl border bg-card text-sm shadow-sm motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300"
    >
      <div className="p-3">
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="shrink-0 sm:w-28 relative">
            <Badge className=" absolute top-2 bg-primary text-primary-foreground right-2 uppercase tracking-wide">
              {moduleName}
            </Badge>
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt={itemName}
                className="aspect-[4/3] w-full rounded-lg border bg-muted object-cover"
              />
            ) : (
              <div className="flex h-28 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/40 text-muted-foreground sm:w-28">
                <PackageSearch className="size-6" aria-hidden="true" />
                <span className="text-[10px] font-semibold uppercase tracking-wide">
                  Sem foto
                </span>
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="break-words text-lg font-semibold leading-tight text-card-foreground">
                  {itemName}
                </h2>
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Hash className="size-3" aria-hidden="true" />
                  Registro {item.id}
                  {item.fabricante ? (
                    <span className="truncate"> · {item.fabricante}</span>
                  ) : null}
                </p>
              </div>
              <Badge variant="outline" className={status.badge}>
                {status.label}
              </Badge>
            </div>

            {item.descricao ? (
              <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {item.descricao}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3 border-l-2 border-foreground/15 pl-3">
              <div>
                <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Boxes className="size-3" aria-hidden="true" /> Estoque atual
                </p>
                <p className="mt-0.5 text-2xl font-bold tabular-nums">
                  {formatQuantity(item.estoque)}
                  <span className="ml-1 text-xs font-medium text-muted-foreground">
                    {unit}
                  </span>
                </p>
              </div>
              <div className="min-w-32">
                <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <MapPin className="size-3" aria-hidden="true" /> Local atual
                </p>
                <p className="mt-1 break-words text-base font-semibold">
                  {item.local || "Não informado"}
                </p>
              </div>
            </div>
          </div>
        </div>

        <dl className="mt-4 grid border-y text-xs sm:grid-cols-2 sm:divide-x">
          <div className="min-w-0 py-3 sm:pr-4 flex flex-row gap-2 justify-between items-center">
              <dt className="flex items-center gap-1.5 font-medium text-muted-foreground">
                <Badge
                  variant="secondary"
                  className="bg-muted text-muted-foreground"
                >
                  <Tag className="size-3.5" aria-hidden="true" />
                  {item.etiqueta}
                </Badge>
              </dt>
            {onEdit ? (
              <Button
                type="button"
                size={"sm"}
                className=" h-min text-xs py-1"
                variant="outline"
                onClick={onEdit}
              >
                <Pencil className="mr-2 size-2.5" aria-hidden="true" />
                {editLabel.toUpperCase()}
              </Button>
            ) : null}
          </div>
        </dl>
      </div>
    </article>
  );
}
