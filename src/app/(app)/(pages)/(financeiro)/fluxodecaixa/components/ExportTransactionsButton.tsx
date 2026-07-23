"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, LoaderCircle } from "lucide-react";
import { Status } from "../../../clientes/types";

type BaseProps = {
  search?: string | null;
  chunk?: number;           // opcional, repassa para o endpoint
  filename?: string;        // opcional, para forçar nome do arquivo
  className?: string;
  title?: string;
  children?: React.ReactNode;
  disabled?: boolean;
};

/** --------- Clientes --------- */
type CustomerProps = BaseProps & {
  kind?: "customers";       // default
  status?: Status;
};

/** --------- Transações --------- */
type TransactionProps = BaseProps & {
  kind: "transactions";
  tipo?: string | null;
  categoria?: string | null;
  categoriaId?: number | null;
  ordemservicoid?: string | number | null;
  vendaid?: string | number | null;
  metodopagamento?: string | null; // pode usar 'metodo' no BE também
  bancoId?: number | null;
  planoContaId?: number | null;
  centroCustoId?: number | null;
  clienteId?: number | null;
  pendente?: boolean | null;
  nomePagador?: string | null;
  documentoPagador?: string | null;
  valorMin?: number | null;
  valorMax?: number | null;
  vinculo?: "OS" | "VENDA" | "EVENTO" | "AVULSO" | null;
  dateFrom?: string | null; // YYYY-MM-DD
  dateTo?: string | null;   // YYYY-MM-DD
};

type Props = CustomerProps | TransactionProps;

export function ExportExcelButton({
  kind = "customers",
  search,
  chunk,
  filename,
  className = "hover:cursor-pointer",
  title,
  children,
  disabled = false,
  ...rest
}: Props) {
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    try {
      setLoading(true);

      const qp = new URLSearchParams();

      // filtros comuns
      if (search) qp.set("search", search);
      if (chunk) qp.set("chunk", String(chunk));

      let endpoint = "";

      if (kind === "customers") {
        endpoint = "/api/customers/export";
        const { status } = rest as CustomerProps;
        if (status) qp.set("status", status);

      } else {
        endpoint = "/api/transaction/export";
        const {
          tipo,
          categoria,
          categoriaId,
          ordemservicoid,
          vendaid,
          metodopagamento,
          bancoId,
          planoContaId,
          centroCustoId,
          clienteId,
          pendente,
          nomePagador,
          documentoPagador,
          valorMin,
          valorMax,
          vinculo,
          dateFrom,
          dateTo,
        } = rest as TransactionProps;

        if (tipo) qp.set("tipo", tipo);
        if (categoria) qp.set("categoria", categoria);
        if (categoriaId != null) qp.set("categoriaId", String(categoriaId));
        if (ordemservicoid != null) qp.set("ordemservicoid", String(ordemservicoid));
        if (vendaid != null) qp.set("vendaid", String(vendaid));
        if (metodopagamento) qp.set("metodopagamento", metodopagamento);
        if (bancoId != null) qp.set("bancoId", String(bancoId));
        if (planoContaId != null) qp.set("planoContaId", String(planoContaId));
        if (centroCustoId != null) qp.set("centroCustoId", String(centroCustoId));
        if (clienteId != null) qp.set("clienteId", String(clienteId));
        if (pendente != null) qp.set("pendente", String(pendente));
        if (nomePagador) qp.set("nomePagador", nomePagador);
        if (documentoPagador) qp.set("documentoPagador", documentoPagador);
        if (valorMin != null) qp.set("valorMin", String(valorMin));
        if (valorMax != null) qp.set("valorMax", String(valorMax));
        if (vinculo) qp.set("vinculo", vinculo);
        if (dateFrom) qp.set("dateFrom", dateFrom); // YYYY-MM-DD
        if (dateTo) qp.set("dateTo", dateTo);       // YYYY-MM-DD
      }

      const res = await fetch(`${endpoint}?${qp.toString()}`, { method: "GET" });

      if (!res.ok) {
        const err = await res.json().catch(() => ({} as any));
        throw new Error(err?.error || "Falha ao exportar");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      // nome de arquivo padrão coerente com o tipo
      const suggested =
        kind === "customers"
          ? `clientes_${(rest as CustomerProps).status || "TODOS"}`
          : buildTxnFilename(rest as TransactionProps);
      const finalName = `${filename || suggested}.xlsx`;

      const a = document.createElement("a");
      a.href = url;
      a.download = finalName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e.message ?? "Erro ao exportar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      onClick={handleExport}
      disabled={loading || disabled}
      size="sm"
      variant="outline"
      className={className}
      title={title ?? (kind === "customers"
        ? "Exportar todos os clientes do filtro atual em Excel"
        : "Exportar todas as transações do filtro atual em Excel")}
    >
      {loading ? (
        <>
          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
          Exportando...
        </>
      ) : (
        <>
          <Download className="mr-2 h-4 w-4" />
          {children ?? "Exportar"}
        </>
      )}
    </Button>
  );
}

/** Wrappers com o mesmo visual — use direto se preferir */
export function ExportCustomersButton(props: Omit<CustomerProps, "kind">) {
  return <ExportExcelButton kind="customers" {...props} />;
}
export function ExportTransactionsButton(props: Omit<TransactionProps, "kind">) {
  return <ExportExcelButton kind="transactions" {...props} />;
}

/** Nome padrão para arquivo de transações */
function buildTxnFilename(p: TransactionProps) {
  const parts = ["transacoes"];
  if (p.dateFrom) parts.push(p.dateFrom);
  if (p.dateTo) parts.push(p.dateTo);
  if (p.tipo) parts.push(p.tipo);
  if (p.categoria) parts.push(p.categoria);
  return parts.join("_");
}
