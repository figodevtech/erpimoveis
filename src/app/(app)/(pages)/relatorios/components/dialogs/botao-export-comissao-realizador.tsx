"use client";

import { Button } from "@/components/ui/button";
import axios from "axios";
import { Download, Loader2 } from "lucide-react";
import React, { useState } from "react";
import { toast } from "@/lib/toast";

function getFilenameFromDisposition(disposition?: string) {
  if (!disposition) return null;
  const match =
    disposition.match(/filename\*?=(?:UTF-8''|")?([^";\n]+)"/i) ||
    disposition.match(/filename=([^;\n]+)/i);
  if (!match?.[1]) return null;
  return decodeURIComponent(match[1].replace(/"/g, "").trim());
}

type Props = {
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  variant?: "default" | "secondary" | "destructive" | "outline" | "ghost" | "link";
  className?: string;
  children?: React.ReactNode;
  disabled?: boolean;
};

export function BotaoExportComissaoRealizador({
  userId,
  dateFrom,
  dateTo,
  variant = "secondary",
  className = "hover:cursor-pointer",
  children,
  disabled = false,
}: Props) {
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    if (!userId) {
      toast.error("Selecione um realizador para exportação.");
      return;
    }

    try {
      setLoading(true);

      const searchParams = new URLSearchParams();
      searchParams.set("userId", userId);
      if (dateFrom) searchParams.set("dateFrom", dateFrom);
      if (dateTo) searchParams.set("dateTo", dateTo);

      const res = await axios.get(`/api/users/export/comissao?${searchParams.toString()}`, {
        responseType: "blob",
      });

      const contentDisposition =
        res.headers["content-disposition"] || res.headers["Content-Disposition"];

      const filename =
        getFilenameFromDisposition(contentDisposition) ||
        `comissao_servico_${new Date().toISOString().replace(/[:.]/g, "-")}.xlsx`;

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
      toast.error(err?.response?.data?.error ?? "Falha ao exportar comissão do realizador.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      onClick={handleExport}
      disabled={loading || disabled}
      variant={variant}
      className={className}
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download />}
      {children ?? (loading ? "Exportando..." : "Exportar")}
    </Button>
  );
}
