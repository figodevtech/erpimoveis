"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { FilePlus2 } from "lucide-react";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
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
  const [isLoadingKpis, setIsLoadingKpis] = useState(false);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState("");
  const [modelo, setModelo] = useState("");
  const [viewMode, setViewMode] = useState<FiscalViewMode>("EMITIDAS_POR_NOS");
  const [isSyncing, setIsSyncing] = useState(false);

  const handleGetKpis = useCallback(async () => {
    setIsLoadingKpis(true);
    try {
      const response = await axios.get("/api/fiscal/kpis");
      setKpis(response.data.kpis);
    } catch (error: any) {
      toast.error("Erro ao carregar KPIs fiscais", {
        description: error?.response?.data?.error ?? error?.message,
      });
    } finally {
      setIsLoadingKpis(false);
    }
  }, []);

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

  const handleSyncTerceiros = useCallback(async (options?: { force?: boolean }) => {
    const force = options?.force === true;
    setIsSyncing(true);
    const toastId = toast.loading(
      force
        ? "Forçando sincronização de documentos fiscais recebidos..."
        : "Sincronizando documentos fiscais recebidos...",
    );
    try {
      const response = await axios.post("/api/fiscal/notas-recebidas/sync", { force });
      toast.success("Sincronização concluída", {
        id: toastId,
        description: `${response.data?.novosDocumentos ?? 0} novo(s) documento(s). ${response.data?.xMotivo ?? ""}`,
      });
      await Promise.all([
        handleGetNotas(1, pagination.limit),
        handleGetKpis(),
      ]);
    } catch (error: any) {
      const data = error?.response?.data;
      const motivo = data?.xMotivo ?? data?.message ?? data?.detail ?? data?.error;
      const cStat = data?.cStat ? `cStat ${data.cStat}.` : null;
      const canForce = Boolean(data?.nextSyncAfter && !data?.consumoIndevidoUntil && !force);
      const blockedUntil = error?.response?.data?.consumoIndevidoUntil ?? error?.response?.data?.nextSyncAfter;
      const blockedMessage = blockedUntil
        ? `Tente novamente após ${new Date(blockedUntil).toLocaleString("pt-BR")}.`
        : undefined;
      const syncErrorDescription = [motivo, cStat, blockedMessage].filter(Boolean).join(" ");
      toast.error("Falha na sincronização", {
        id: toastId,
        description:
          syncErrorDescription ||
          error?.message,
        action: canForce
          ? {
              label: "Forçar tentativa",
              onClick: () => {
                void handleSyncTerceiros({ force: true });
              },
            }
          : undefined,
      });
    } finally {
      setIsSyncing(false);
    }
  }, [handleGetKpis, handleGetNotas, pagination.limit]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void handleGetNotas(1, pagination.limit);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [handleGetNotas, pagination.limit]);

  useEffect(() => {
    void handleGetKpis();
  }, [handleGetKpis]);

  return (
    <div className="space-y-4">
      <FiscalCards kpis={kpis} isLoading={isLoadingKpis} />
      <div className="flex justify-end">
        <Button asChild>
          <Link href="/fiscal/nfe-avulsa">
            <FilePlus2 className="h-4 w-4" />
            Emitir NF-e
          </Link>
        </Button>
      </div>
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
