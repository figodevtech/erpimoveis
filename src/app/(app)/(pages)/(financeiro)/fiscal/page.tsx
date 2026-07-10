"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";

import FiscalCards from "./components/fiscal-cards";
import FiscalTable from "./components/fiscal-table";
import type { FiscalKpis, FiscalViewMode, NotaFiscal, Pagination } from "./types";

const initialPagination: Pagination = {
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 0,
};

export default function FiscalPage() {
  const [notas, setNotas] = useState<NotaFiscal[]>([]);
  const [kpis, setKpis] = useState<FiscalKpis | undefined>(undefined);
  const [pagination, setPagination] = useState<Pagination>(initialPagination);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState("");
  const [modelo, setModelo] = useState("");
  const [viewMode, setViewMode] = useState<FiscalViewMode>("TODAS");
  const [isSyncing, setIsSyncing] = useState(false);

  const handleGetNotas = useCallback(
    async (page = 1, limit = pagination.limit) => {
      setIsLoading(true);
      try {
        const endpoint =
          viewMode === "EMITIDAS_TERCEIROS"
            ? "/api/fiscal/notas-recebidas"
            : "/api/fiscal/notas-emitidas";

        const response = await axios.get(endpoint, {
          params: {
            page,
            limit,
            search: search || undefined,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
            status: status || undefined,
            modelo: modelo || undefined,
            viewMode,
          },
        });

        setNotas(response.data.data ?? []);
        setKpis(response.data.kpis);
        setPagination(response.data.pagination ?? initialPagination);
      } catch (error: any) {
        toast.error("Erro ao carregar notas fiscais", {
          description: error?.response?.data?.error ?? error?.message,
        });
      } finally {
        setIsLoading(false);
      }
    },
    [dateFrom, dateTo, modelo, pagination.limit, search, status, viewMode],
  );

  const handleSyncTerceiros = useCallback(async () => {
    setIsSyncing(true);
    const toastId = toast.loading("Sincronizando documentos fiscais recebidos...");
    try {
      const response = await axios.post("/api/fiscal/notas-recebidas/sync", {});
      toast.success("Sincronização concluída", {
        id: toastId,
        description: `${response.data?.novosDocumentos ?? 0} novo(s) documento(s). ${response.data?.xMotivo ?? ""}`,
      });
      await handleGetNotas(1, pagination.limit);
    } catch (error: any) {
      const blockedUntil = error?.response?.data?.consumoIndevidoUntil ?? error?.response?.data?.nextSyncAfter;
      const blockedMessage = blockedUntil
        ? `Tente novamente após ${new Date(blockedUntil).toLocaleString("pt-BR")}.`
        : undefined;
      toast.error("Falha na sincronização", {
        id: toastId,
        description:
          blockedMessage ??
          error?.response?.data?.detail ??
          error?.response?.data?.xMotivo ??
          error?.message,
      });
    } finally {
      setIsSyncing(false);
    }
  }, [handleGetNotas, pagination.limit]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void handleGetNotas(1, pagination.limit);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [handleGetNotas, pagination.limit]);

  return (
    <div className="space-y-4">
      <FiscalCards kpis={kpis} isLoading={isLoading} />
      <FiscalTable
        notas={notas}
        pagination={pagination}
        isLoading={isLoading}
        search={search}
        dateFrom={dateFrom}
        dateTo={dateTo}
        status={status}
        modelo={modelo}
        viewMode={viewMode}
        setSearch={setSearch}
        setDateFrom={setDateFrom}
        setDateTo={setDateTo}
        setStatus={setStatus}
        setModelo={setModelo}
        setViewMode={setViewMode}
        handleGetNotas={handleGetNotas}
        onSyncTerceiros={handleSyncTerceiros}
        isSyncing={isSyncing}
      />
    </div>
  );
}
