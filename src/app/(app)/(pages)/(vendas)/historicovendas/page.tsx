"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Cards from "./components/cards";
import axios from "axios";
import {
  Pagination,
  VendaResumo,
  VendaStatusMetricsData,
} from "./types";
import VendasDataTable from "./components/vendas-data-table";
import { dataDoFiltro, type VendasListFilters } from "@/lib/vendas/filtros";
import type { FaseVenda } from "@/lib/vendas/fase";
import { toast } from "@/lib/toast";

function formatMonthFromDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0"); // 0-11 -> 1-12
  return `${year}-${month}`;
}
export default function HistoricoVendas() {
  const [loadingStatusCounter, setLoadingStatusCounter] = useState(false);
  const [fase, setFase] = useState<FaseVenda>("ABERTAS");

  const totalVendas = 0;
  const [data, setData] = useState<VendaStatusMetricsData | null>(null);
  const [vendas, setVendas] = useState<VendaResumo[]>([]);
  const date = new Date(); // hoje
  const month = formatMonthFromDate(date);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedVendaId, setSelectedVendaId] = useState<number | undefined>(
    undefined
  );
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });
  const requisicao = useRef<AbortController | null>(null);
  const [search, setSearch] = useState("");
  const buscaAnterior = useRef(search);
  const [filters, setFilters] = useState<VendasListFilters>({
    cliente: "",
    notaNumero: "",
  });

  const handleGetVendas = useCallback(async (
    pageNumber?: number,
    limit?: number,
    searchText?: string,
    faseValue?: FaseVenda,
    listFilters?: VendasListFilters,
  ) => {
    requisicao.current?.abort();
    const controller = new AbortController();
    requisicao.current = controller;
    setIsLoading(true);
    try {
      const activeFilters = listFilters ?? filters;
      const response = await axios.get("/api/venda", {
        signal: controller.signal,
        params: {
          view: "historico",
          page: pageNumber || 1,
          limit: limit || pagination.limit,
          search: searchText || undefined,
          fase: faseValue,
          status: activeFilters.status || "TODOS",
          statusEntrega: activeFilters.statusEntrega || "",
          cliente: activeFilters.cliente || "",
          notaNumero: activeFilters.notaNumero || "",
          dateFrom: dataDoFiltro(activeFilters.dataInicio),
          dateTo: dataDoFiltro(activeFilters.dataFim),
          apenasMinhas: activeFilters.apenasMinhas ? "1" : "",
          canal: activeFilters.canal || "",
          categoriaVendaId: activeFilters.categoriaVendaId || "",
          vendedorId: activeFilters.vendedorId || "",
          valorMin: activeFilters.valorMin ?? "",
          valorMax: activeFilters.valorMax ?? "",
        },
      });
      if (!controller.signal.aborted && response.status === 200) {
        const { data } = response;
        setVendas(data.data);
        setPagination(data.pagination);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setVendas([]);
      setPagination({ total: 0, page: 1, limit: limit || pagination.limit, totalPages: 1 });
      toast.error("Erro ao buscar vendas", {
        description: axios.isAxiosError(error) ? error.response?.data?.error || "Tente novamente." : "Tente novamente.",
      });
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, [filters, pagination.limit]);

  const fetchMetrics = useCallback(async () => {
    try {
      setLoadingStatusCounter(true);

      const url = month
        ? `/api/venda/status-counter?month=${month}`
        : `/api/venda/status-counter`;

      const res = await axios.get(url);

      setData(res.data.data); // o payload vem como {data: {...}}
    } catch {
    } finally {
      setLoadingStatusCounter(false);
    }
  }, [month]);

  useEffect(() => {
    // Debounce apenas da digitacao; abertura, filtros e tamanho da pagina sao imediatos.
    const atraso = buscaAnterior.current === search ? 0 : 350;
    buscaAnterior.current = search;
    const timeout = window.setTimeout(() => {
      handleGetVendas(1, pagination.limit, search, fase);
    }, atraso);

    return () => { window.clearTimeout(timeout); requisicao.current?.abort(); };
  }, [search, fase, pagination.limit, handleGetVendas]);
  useEffect(() => {
    const timer = window.setTimeout(() => void fetchMetrics(), 0);
    return () => window.clearTimeout(timer);
  }, [fetchMetrics]);

  return (
    <div className="mx-auto space-y-6">
      <Cards
        loadingStatusCounter={loadingStatusCounter}
        totalVendas={totalVendas}
        statusCounts={data}
      />
      <VendasDataTable
        filters={filters}
        setFilters={setFilters}
        handleGetVendas={handleGetVendas}
        isLoading={isLoading}
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        fetchStatusCounts={fetchMetrics}
        pagination={pagination}
        search={search}
        setSearch={setSearch}
        selectedVendaId={selectedVendaId}
        setSelectedVendaId={setSelectedVendaId}
        fase={fase}
        setFase={setFase}
        vendas={vendas}
      />
    </div>
  );
}
