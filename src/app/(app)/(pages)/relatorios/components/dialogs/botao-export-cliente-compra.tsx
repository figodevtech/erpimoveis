"use client";

import { Button } from "@/components/ui/button";
import axios from "axios";
import { Download, Loader2 } from "lucide-react";
import React, { useState } from "react";
import { toast } from "@/lib/toast";

type FiltrosExport = {
  q?: string;
  status?: string;
  clienteId?: number;
  dateFrom?: string; // "YYYY-MM-DD"
  dateTo?: string; // "YYYY-MM-DD"
  chunk?: number;
};

function buildQuery(params: FiltrosExport) {
  const sp = new URLSearchParams();

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

type BotaoExportHistoricoComprasProps = {
  clienteId?: number;
  dateFrom?: string;
  dateTo?: string;
  disabled?: boolean;
};

export function BotaoExportHistoricoCompras({
  clienteId,
  dateFrom,
  dateTo,
  disabled = false,
}: BotaoExportHistoricoComprasProps) {
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    if(!clienteId){
      toast.error("Selecione um cliente para exportação.")
      return;
    }
    try {
      setLoading(true);

      const filtros: FiltrosExport = {
        q: "",
        status: "",
        clienteId, // <- vindo por props
        dateFrom,
        dateTo,
        chunk: 1000,
      };

      const url = "/api/venda/export/cliente" + buildQuery(filtros);

      const res = await axios.get(url, {
        responseType: "blob",
      });

      const contentDisposition =
        res.headers["content-disposition"] || res.headers["Content-Disposition"];
      const filename =
        getFilenameFromDisposition(contentDisposition) ||
        `historico_compras_vendas_${new Date()
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
      toast.error(err?.response?.data?.error ?? "Falha ao exportar histórico de compras.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      onClick={handleExport}
      disabled={loading || disabled}
      variant="default"
      className="hover:cursor-pointer"
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download/>}{" "}
      {loading ? "Exportando..." : "Exportar Excel"}
    </Button>
  );
}
