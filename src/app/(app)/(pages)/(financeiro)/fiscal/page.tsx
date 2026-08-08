"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import axios from "axios";
import { toast } from "@/lib/toast";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  const searchParams = useSearchParams();
  const paramSearch = searchParams.get("search") || "";
  const paramViewMode = searchParams.get("viewMode") as FiscalViewMode | null;

  const [notas, setNotas] = useState<NotaFiscal[]>([]);
  const [kpis, setKpis] = useState<FiscalKpis | undefined>(undefined);
  const [pagination, setPagination] = useState<Pagination>(initialPagination);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingKpis, setIsLoadingKpis] = useState(false);
  const [search, setSearch] = useState(paramSearch);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState("");
  const [modelo, setModelo] = useState("");
  const [viewMode, setViewMode] = useState<FiscalViewMode>(paramViewMode || "EMITIDAS_POR_NOS");

  useEffect(() => {
    if (paramSearch) setSearch(paramSearch);
    if (paramViewMode) setViewMode(paramViewMode);
  }, [paramSearch, paramViewMode]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [companyChange, setCompanyChange] = useState<{
    previousCnpj: string;
    currentCnpj: string;
    previousAmbiente: string;
    currentAmbiente: string;
  } | null>(null);

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

  const handleSyncTerceiros = useCallback(async (options?: {
    confirmCompanyChange?: boolean;
  }) => {
    const confirmCompanyChange = options?.confirmCompanyChange === true;
    setIsSyncing(true);
    const toastId = toast.loading("Sincronizando documentos fiscais recebidos...");
    try {
      const response = await axios.post("/api/fiscal/notas-recebidas/sync", {
        confirmCompanyChange,
      });

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
      if (data?.companyChangeDetected) {
        toast.dismiss(toastId);
        setCompanyChange({
          previousCnpj: data.previousCnpj ?? "Não informado",
          currentCnpj: data.currentCnpj ?? "Não informado",
          previousAmbiente: data.previousAmbiente ?? "Não informado",
          currentAmbiente: data.currentAmbiente ?? "Não informado",
        });
        return;
      }
      const motivo = data?.xMotivo ?? data?.message ?? data?.detail ?? data?.error;
      const cStat = data?.cStat ? `cStat ${data.cStat}.` : null;
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
      <AlertDialog
        open={Boolean(companyChange)}
        onOpenChange={(open) => {
          if (!open && !isSyncing) setCompanyChange(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Novo contexto fiscal detectado</AlertDialogTitle>
            <AlertDialogDescription>
              O CNPJ ou o ambiente fiscal é diferente daquele usado na última sincronização de notas fiscais.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-md border bg-muted/30 p-3">
              <p>CNPJ anterior: <span className="font-medium">{companyChange?.previousCnpj}</span></p>
              <p>CNPJ atual: <span className="font-medium">{companyChange?.currentCnpj}</span></p>
              <p>Ambiente anterior: <span className="font-medium">{companyChange?.previousAmbiente}</span></p>
              <p>Ambiente atual: <span className="font-medium">{companyChange?.currentAmbiente}</span></p>
            </div>
            <p className="text-muted-foreground">
              Ao prosseguir, as notas recebidas do contexto anterior serão removidas da listagem. Se este
              contexto já tiver sido utilizado, seu último NSU será restaurado; caso contrário, a consulta
              começará do NSU zero. Confirme também que o certificado digital corresponde ao CNPJ atual.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSyncing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={isSyncing}
              onClick={(event) => {
                event.preventDefault();
                setCompanyChange(null);
                void handleSyncTerceiros({ confirmCompanyChange: true });
              }}
            >
              Ativar e sincronizar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
