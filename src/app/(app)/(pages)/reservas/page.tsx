"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import axios from "axios";
import Cards from "./components/cards";
import SearchFilter from "./components/searchfilter";
import ReservasDataTable from "./components/reservas-data-table";
import useReservasStatusCounter from "./hooks/status-counter";
import { Pagination, Reserva, StatusReserva } from "./types";
import { useModulePermission } from "@/components/imobiliario/shared";

const EntityDialog = dynamic(() => import("@/components/imobiliario/entity-dialog"), {
  loading: () => <p role="status" className="p-3 text-sm">Carregando cadastro…</p>,
});

export default function ReservasPage() {
  const { can, ready } = useModulePermission();
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [status, setStatus] = useState<StatusReserva>(StatusReserva.TODOS);
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [propertyId, setPropertyId] = useState<number | null>(null);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [calendarVersion, setCalendarVersion] = useState(0);

  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });

  const {
    statusCounts,
    totalReservas,
    ativas,
    finalizadas,
    loadingStatusCounter,
    fetchStatusCounts,
  } = useReservasStatusCounter();

  const [selectedDialog, setSelectedDialog] = useState<{ id?: number; seed?: any } | null>(null);

  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  const fetchReservas = useCallback(
    async (
      pageNumber?: number,
      limitNumber?: number,
      searchTerm?: string,
      statusFilter?: StatusReserva,
      inicioFilter?: string,
      fimFilter?: string,
      propertyFilter?: number | null
    ) => {
      const pageToUse = pageNumber ?? pagination.page;
      const limitToUse = limitNumber ?? pagination.limit;
      const searchToUse = searchTerm !== undefined ? searchTerm : search;
      const statusToUse = statusFilter ?? status;
      const inicioToUse = inicioFilter !== undefined ? inicioFilter : inicio;
      const fimToUse = fimFilter !== undefined ? fimFilter : fim;
      const propertyToUse = propertyFilter !== undefined ? propertyFilter : propertyId;

      const requestId = ++requestSequence.current;
      requestController.current?.abort();
      const controller = new AbortController();
      requestController.current = controller;

      setIsLoading(true);

      const params = new URLSearchParams({
        page: String(pageToUse),
        pageSize: String(limitToUse),
      });

      if (searchToUse) {
        params.set("q", searchToUse);
      }

      if (statusToUse !== StatusReserva.TODOS) {
        params.set("status", statusToUse);
      }

      if (inicioToUse) {
        params.set("inicio", inicioToUse);
      }

      if (fimToUse) {
        params.set("fim", fimToUse);
      }

      if (propertyToUse) {
        params.set("imovel_id", String(propertyToUse));
      }

      try {
        const response = await axios.get(`/api/reservas?${params.toString()}`, {
          signal: controller.signal,
        });

        if (response.status === 200 && requestId === requestSequence.current) {
          const { items = [], total = 0 } = response.data;
          setReservas(items);
          setPagination({
            page: pageToUse,
            limit: limitToUse,
            total,
            totalPages: Math.ceil(total / limitToUse),
          });
        }
      } catch (error) {
        if (!axios.isCancel(error) && requestId === requestSequence.current) {
          console.error("Erro ao buscar reservas:", error);
        }
      } finally {
        if (requestId === requestSequence.current) {
          setIsLoading(false);
        }
      }
    },
    [pagination.page, pagination.limit, search, status, inicio, fim, propertyId]
  );

  useEffect(() => {
    requestSequence.current += 1;
    requestController.current?.abort();

    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
    }, 400);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    return () => requestController.current?.abort();
  }, []);

  useEffect(() => {
    if (!ready || !can("reservas:visualizar")) return;
    void fetchReservas(1, pagination.limit, search, status, inicio, fim, propertyId);
  }, [status, search, inicio, fim, propertyId, ready, can, pagination.limit]);

  const handleRefresh = () => {
    void fetchReservas(pagination.page, pagination.limit, search, status, inicio, fim, propertyId);
    void fetchStatusCounts();
    setCalendarVersion((v) => v + 1);
  };

  const handleOpenDialog = (id?: number, seed?: any) => {
    setSelectedDialog({ id, seed });
  };

  if (ready && !can("reservas:visualizar")) {
    return (
      <p role="alert" className="rounded-xl border p-6 text-sm">
        Seu perfil não tem acesso a este módulo.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cards de KPI */}
      <Cards
        statusCounts={statusCounts}
        loadingStatusCounter={loadingStatusCounter}
        totalReservas={totalReservas}
        ativas={ativas}
        finalizadas={finalizadas}
      />

      {/* Barra de Filtros e Busca Estilizada */}
      <SearchFilter
        search={searchInput}
        setSearch={setSearchInput}
        status={status}
        setStatus={setStatus}
        inicio={inicio}
        setInicio={setInicio}
        fim={fim}
        setFim={setFim}
        propertyId={propertyId}
        setPropertyId={setPropertyId}
        onSearch={() => {
          const term = searchInput.trim();
          if (term === search) {
            void fetchReservas(1, pagination.limit, term, status, inicio, fim, propertyId);
          } else {
            setSearch(term);
          }
        }}
        onClear={() => {
          setSearchInput("");
          if (search === "") {
            void fetchReservas(1, pagination.limit, "", status, inicio, fim, propertyId);
          } else {
            setSearch("");
          }
        }}
      />

      {/* Tabela de Reservas dentro do Card com alternador de exibição */}
      <ReservasDataTable
        reservas={reservas}
        isLoading={isLoading}
        pagination={pagination}
        view={view}
        onViewChange={setView}
        onPageChange={(page) => fetchReservas(page, pagination.limit, search, status, inicio, fim, propertyId)}
        onPageSizeChange={(limit) => fetchReservas(1, limit, search, status, inicio, fim, propertyId)}
        onRefresh={handleRefresh}
        onSelectReserva={(id) => handleOpenDialog(id)}
        onNewReserva={can("reservas:criar") ? (seed) => handleOpenDialog(undefined, seed) : undefined}
        canCreate={can("reservas:criar")}
        canEdit={can("reservas:editar")}
        propertyId={propertyId}
        calendarVersion={calendarVersion}
      />

      {/* Diálogo de Cadastro / Edição */}
      {selectedDialog ? (
        <EntityDialog
          key={selectedDialog.id ?? "new"}
          kind="reservas"
          id={selectedDialog.id}
          initial={selectedDialog.seed}
          open
          onOpenChange={(open) => {
            if (!open) setSelectedDialog(null);
          }}
          onSaved={handleRefresh}
        />
      ) : null}
    </div>
  );
}
