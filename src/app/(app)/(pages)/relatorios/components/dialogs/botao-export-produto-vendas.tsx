"use client";

import { Button } from "@/components/ui/button";
import axios from "axios";
import { Download, Loader2 } from "lucide-react";
import React, { useState } from "react";
import { toast } from "@/lib/toast";

type FiltrosExportProduto = {
  produtoId?: number;
  q?: string;
  status?: string;
  clienteId?: number;
  dateFrom?: string; // "YYYY-MM-DD"
  dateTo?: string; // "YYYY-MM-DD"
  chunk?: number;
};

function buildQuery(params: FiltrosExportProduto) {
  const sp = new URLSearchParams();

  if (params.produtoId != null) sp.set("produtoId", String(params.produtoId));
  if (params.q) sp.set("q", params.q);
  if (params.status) sp.set("status", params.status);
  if (params.clienteId != null) sp.set("clienteId", String(params.clienteId));
  if (params.dateFrom) sp.set("dateFrom", params.dateFrom);
  if (params.dateTo) sp.set("dateTo", params.dateTo);
  if (params.chunk != null) sp.set("chunk", String(params.chunk));

  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

function getFilenameFromDisposition(disposition?: string) {
  // Content-Disposition: attachment; filename="arquivo.xlsx"
  if (!disposition) return null;
  const match =
    disposition.match(/filename\*?=(?:UTF-8''|")?([^";\n]+)"/i) ||
    disposition.match(/filename=([^;\n]+)/i);
  if (!match?.[1]) return null;
  return decodeURIComponent(match[1].replace(/"/g, "").trim());
}

type BotaoExportProdutoVendasProps = {
  produtoId?: number;
  q?: string;
  status?: string;
  clienteId?: number;
  dateFrom?: string; // "YYYY-MM-DD"
  dateTo?: string; // "YYYY-MM-DD"
  chunk?: number;
  variant?: "default" | "secondary" | "destructive" | "outline" | "ghost" | "link";
  className?: string;
  children?: React.ReactNode;
};

export function BotaoExportProdutoVendas({
  produtoId,
  q = "",
  status = "",
  clienteId,
  dateFrom,
  dateTo,
  chunk = 1000,
  variant = "secondary",
  className = "hover:cursor-pointer",
  children,
}: BotaoExportProdutoVendasProps) {
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    if (!produtoId) {
      toast.error("Selecione um produto para exportação.");
      return;
    }

    try {
      setLoading(true);

      const filtros: FiltrosExportProduto = {
        produtoId,
        q,
        status,
        clienteId,
        dateFrom,
        dateTo,
        chunk,
      };

      const url = "/api/venda/export/produto" + buildQuery(filtros);

      const res = await axios.get(url, {
        responseType: "blob",
      });

      const contentDisposition =
        res.headers["content-disposition"] || res.headers["Content-Disposition"];

      const filename =
        getFilenameFromDisposition(contentDisposition) ||
        `vendas_produto_${produtoId}_${new Date()
          .toISOString()
          .replace(/[:.]/g, "-")}.xlsx`;

      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (err: any) {
      console.error(err);
      toast.error(
        err?.response?.data?.error ?? "Falha ao exportar vendas do produto."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      onClick={handleExport}
      disabled={loading}
      variant={variant}
      className={className}
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download />}{" "}
      {children ?? (loading ? "Exportando..." : "Exportar")}
    </Button>
  );
}
