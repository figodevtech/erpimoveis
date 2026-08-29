"use client";
import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { Customer, Pagination, Status } from "./types";
import useStatusCounter from "./hooks/status-counter";

// ❌ Header removido (agora existe header global)
// import Header from "./components/header";

import Cards from "./components/cards";
import SearchFilter from "./components/searchfilter";
import CustomersDataTable from "./components/customers-data-table";

export default function ClientesPage() {
  const [customerItems, setCustomerItems] = useState<Customer[]>([]);
  const {
    statusCounts,
    loadingStatusCounter,
    totalCustomers,
    fetchStatusCounts,
  } = useStatusCounter();
  const [isOpen, setIsOpen] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });
  const [status, setStatus] = useState<Status>(Status.TODOS);
  const [devedores, setDevedores] = useState(false);
  /*
   * O filtro de devedores é estado desta página, não da tabela.
   *
   * A tabela chama `handleGetCustomers` na paginação passando só página, limite,
   * busca e status — mudar essa assinatura obrigaria a tocar em oito chamadas
   * para carregar um dado que ela não usa. A ref deixa a paginação preservar o
   * filtro sozinha, e quem precisa forçar um valor passa por parâmetro.
   */
  const devedoresRef = useRef(devedores);
  devedoresRef.current = devedores;
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  // Mantemos apenas o setter, já que o antigo Header (controlado) saiu
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | undefined>(undefined);

  const [isAlertOpen, setIsAlertOpen] = useState(false);

  const handleGetCustomers = async (
    pageNumber?: number,
    limit?: number,
    search?: string,
    status?: Status,
    devedoresParam?: boolean
  ) => {
    const soDevedores = devedoresParam ?? devedoresRef.current;
    const requestId = ++requestSequence.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setIsLoading(true);
    try {
      const response = await axios.get("/api/customers", {
        signal: controller.signal,
        params: {
          page: pageNumber || 1,
          limit: limit || pagination.limit,
          search: search || undefined,
          status: status || "TODOS",
          devedores: soDevedores ? 1 : undefined,
        },
      });
      if (response.status === 200 && requestId === requestSequence.current) {
        const { data } = response;
        setCustomerItems(data.data);
        setPagination(data.pagination);
      }
    } catch (error) {
      if (!axios.isCancel(error) && requestId === requestSequence.current) {
        console.log("Erro ao buscar clientes:", error);
      }
    } finally {
      if (requestId === requestSequence.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    requestSequence.current += 1;
    requestController.current?.abort();

    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
    }, 450);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => () => requestController.current?.abort(), []);

  useEffect(() => {
    if (selectedCustomerId) {
      setIsOpen(true);
    }
  }, [selectedCustomerId]);

  useEffect(() => {
    handleGetCustomers(1, pagination.limit, search, status, devedores);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, search, devedores]);

  return (
    <div className="space-y-6">
      {/* ✅ Header local removido */}

      <Cards
        statusCounts={statusCounts}
        loadingStatusCounter={loadingStatusCounter}
        totalCustomers={totalCustomers}
      />

      <SearchFilter
        search={searchInput}
        setSearch={setSearchInput}
        onSearch={() => {
          const term = searchInput.trim();
          if (term === search) void handleGetCustomers(1, pagination.limit, term, status);
          else setSearch(term);
        }}
        onClear={() => {
          setSearchInput("");
          if (search === "") void handleGetCustomers(1, pagination.limit, "", status);
          else setSearch("");
        }}
        setStatus={setStatus}
        status={status}
        devedores={devedores}
        setDevedores={setDevedores}
      />

      {/* Customers Table */}
      <CustomersDataTable
        isAlertOpen={isAlertOpen}
        setIsAlertOpen={setIsAlertOpen}
        selectedCustomerId={selectedCustomerId}
        setSelectedCustomerId={setSelectedCustomerId}
        customerItems={customerItems}
        fetchStatusCounts={fetchStatusCounts}
        handleGetCustomers={handleGetCustomers}
        isLoading={isLoading}
        pagination={pagination}
        search={search}
        status={status}
        isOpen={isOpen}
        setIsOpen={setIsOpen}
      />
    </div>
  );
}
