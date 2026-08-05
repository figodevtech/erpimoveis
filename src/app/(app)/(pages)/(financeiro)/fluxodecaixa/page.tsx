"use client";
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import {
  type FluxoViewMode,
  StatusInfo,
  Tipo_transacao,
  Transaction,
  type TransactionRelationFilters,
} from "./types";
import Cards from "./components/cards";
import FinancialTable from "./components/financialTable";

export default function FinanceiroPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [statusInfo, setStatusInfo] = useState<StatusInfo | undefined>(
    undefined
  );
  const [tipo, setTipo] = useState<Tipo_transacao | "">("");
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [viewMode, setViewMode] = useState<FluxoViewMode>("TODAS");
  const [relationFilters, setRelationFilters] = useState<TransactionRelationFilters>({
    categoriaId: "",
    bancoId: "",
    planoContaId: "",
    centroCustoId: "",
  });
  // Contas a pagar/receber se leem por vencimento: o que vence antes vem antes.
  // O extrato geral continua do lançamento mais novo para o mais antigo.
  const ordemData =
    viewMode === "A_PAGAR" || viewMode === "A_RECEBER" ? "asc" : "desc";

  const handleGetTransactions = useCallback(async (
    pageNumber?: number,
    limit?: number,
    search?: string,
    dateFrom?: string,
    dateTo?: string,
    tipo?: Tipo_transacao | "",
    pendente?: boolean | ""
  ) => {
    setIsLoading(true);
    try {
      const response = await axios.get("/api/transaction", {
        params: {
          page: pageNumber || 1,
          limit: limit || pagination.limit,
          search: search || undefined,
          tipo: tipo,
          pendente: pendente === "" ? undefined : pendente,
          dateFrom: dateFrom,
          dateTo: dateTo,
          categoriaId: relationFilters.categoriaId || undefined,
          bancoId: relationFilters.bancoId || undefined,
          planoContaId: relationFilters.planoContaId || undefined,
          centroCustoId: relationFilters.centroCustoId || undefined,
          ordem: ordemData,
        },
      });
      if (response.status === 200) {
        const { data } = response;
        setTransactions(data.data);
        setPagination(data.pagination);
      }
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [ordemData, pagination.limit, relationFilters]);

  const handleGetStatusCounter = useCallback(async () => {
    setIsLoadingStatus(true);
    try {
      const response = await axios.get("/api/transaction/status-counter", {});
      const response2 = await axios.get("/api/transaction/status-counter", {
        params: { offset: -1 },
      });
      if (response.status === 200 && response2.status === 200) {
        setStatusInfo((current) => ({
          ...current,
          mesAtual: response.data,
          mesAnterior: response2.data,
        }));
      }
    } catch {
    } finally {
      setIsLoadingStatus(false);
    }
  }, []);

  const effectiveTipo =
    viewMode === "A_RECEBER"
      ? Tipo_transacao.RECEITA
      : viewMode === "A_PAGAR"
      ? Tipo_transacao.DESPESA
      : tipo;

  const effectivePendente: boolean | "" =
    viewMode === "TODAS" ? "" : viewMode === "LIQUIDADAS" ? false : true;

  useEffect(() => {
    handleGetTransactions(
      1,
      pagination.limit,
      search,
      dateFrom,
      dateTo,
      effectiveTipo,
      effectivePendente,
    );
  }, [
    dateFrom,
    dateTo,
    effectivePendente,
    effectiveTipo,
    handleGetTransactions,
    pagination.limit,
    search,
  ]);

  useEffect(() => {
    // A_PAGAR/A_RECEBER já fixam o tipo; Liquidadas aceita filtrar por tipo.
    if ((viewMode === "A_PAGAR" || viewMode === "A_RECEBER") && tipo) {
      setTipo("");
    }
  }, [tipo, viewMode]);

  useEffect(() => {
    void handleGetStatusCounter();
  }, [handleGetStatusCounter]);

  return (
    <div className="p-y-4 space-y-4">
      {/* <Header /> */}
      <Cards isLoadingStatus={isLoadingStatus} statusInfo={statusInfo} />
      <FinancialTable
        dateFrom={dateFrom}
        dateTo={dateTo}
        handleGetStatusCounter={handleGetStatusCounter}
        isLoading={isLoading}
        search={search}
        tipo={effectiveTipo}
        pendenteFilter={effectivePendente}
        viewMode={viewMode}
        rawTipo={tipo}
        setTipo={setTipo}
        setSearch={setSearch}
        dateSearch={search}
        setDateFrom={setDateFrom}
        setDateTo={setDateTo}
        setViewMode={setViewMode}
        relationFilters={relationFilters}
        setRelationFilters={setRelationFilters}
        handleGetTransactions={handleGetTransactions}
        pagination={pagination}
        transactions={transactions}
      />
    </div>
  );
}

