"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import axios from "axios";
import Cards from "./components/cards";
import SearchFilter from "./components/searchfilter";
import ProprietariosDataTable from "./components/proprietarios-data-table";
import useProprietariosStatusCounter from "./hooks/status-counter";
import { Pagination, Proprietario, StatusProprietario } from "./types";
import { useModulePermission } from "@/components/imobiliario/shared";
import { removeEntity } from "@/components/imobiliario/row-actions";

const EntityDialog = dynamic(() => import("@/components/imobiliario/entity-dialog"), {
  loading: () => <p role="status" className="p-3 text-sm">Carregando cadastro…</p>,
});

export default function ProprietariosPage() {
  const { can, ready } = useModulePermission();
  const [proprietarios, setProprietarios] = useState<Proprietario[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [status, setStatus] = useState<StatusProprietario>(StatusProprietario.TODOS);
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });

  const {
    statusCounts,
    totalProprietarios,
    loadingStatusCounter,
    fetchStatusCounts,
  } = useProprietariosStatusCounter();

  const [selectedId, setSelectedId] = useState<number | undefined>(undefined);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  const fetchProprietarios = useCallback(
    async (pageNumber?: number, limitNumber?: number, searchTerm?: string, statusFilter?: StatusProprietario) => {
      const pageToUse = pageNumber ?? pagination.page;
      const limitToUse = limitNumber ?? pagination.limit;
      const searchToUse = searchTerm !== undefined ? searchTerm : search;
      const statusToUse = statusFilter ?? status;

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

      if (statusToUse !== StatusProprietario.TODOS) {
        params.set("ativo", String(statusToUse === StatusProprietario.ATIVO));
      }

      try {
        const response = await axios.get(`/api/proprietarios?${params.toString()}`, {
          signal: controller.signal,
        });

        if (response.status === 200 && requestId === requestSequence.current) {
          const { items = [], total = 0 } = response.data;
          setProprietarios(items);
          setPagination({
            page: pageToUse,
            limit: limitToUse,
            total,
            totalPages: Math.ceil(total / limitToUse),
          });
        }
      } catch (error) {
        if (!axios.isCancel(error) && requestId === requestSequence.current) {
          console.error("Erro ao buscar proprietários:", error);
        }
      } finally {
        if (requestId === requestSequence.current) {
          setIsLoading(false);
        }
      }
    },
    [pagination.page, pagination.limit, search, status]
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
    if (!ready || !can("proprietarios:visualizar")) return;
    void fetchProprietarios(1, pagination.limit, search, status);
  }, [status, search, ready, can, pagination.limit]);

  const handleRefresh = () => {
    void fetchProprietarios(pagination.page, pagination.limit, search, status);
    void fetchStatusCounts();
  };

  const handleOpenDialog = (id?: number) => {
    setSelectedId(id);
    setIsDialogOpen(true);
  };

  if (ready && !can("proprietarios:visualizar")) {
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
        totalProprietarios={totalProprietarios}
      />

      {/* Barra de Filtros e Busca Estilizada */}
      <SearchFilter
        search={searchInput}
        setSearch={setSearchInput}
        status={status}
        setStatus={setStatus}
        onSearch={() => {
          const term = searchInput.trim();
          if (term === search) {
            void fetchProprietarios(1, pagination.limit, term, status);
          } else {
            setSearch(term);
          }
        }}
        onClear={() => {
          setSearchInput("");
          if (search === "") {
            void fetchProprietarios(1, pagination.limit, "", status);
          } else {
            setSearch("");
          }
        }}
      />

      {/* Tabela de Proprietários dentro do Card */}
      <ProprietariosDataTable
        proprietarios={proprietarios}
        isLoading={isLoading}
        pagination={pagination}
        onPageChange={(page) => fetchProprietarios(page, pagination.limit, search, status)}
        onPageSizeChange={(limit) => fetchProprietarios(1, limit, search, status)}
        onRefresh={handleRefresh}
        onSelectProprietario={(id) => handleOpenDialog(id)}
        onNewProprietario={can("proprietarios:criar") ? () => handleOpenDialog(undefined) : undefined}
        onDeleteProprietario={
          can("proprietarios:excluir")
            ? async (id) => {
                if (await removeEntity("proprietarios", id)) handleRefresh();
              }
            : undefined
        }
        canCreate={can("proprietarios:criar")}
        canEdit={can("proprietarios:editar")}
      />

      {/* Diálogo de Cadastro / Edição */}
      {isDialogOpen ? (
        <EntityDialog
          key={selectedId ?? "new"}
          kind="proprietarios"
          id={selectedId}
          open={isDialogOpen}
          onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) setSelectedId(undefined);
          }}
          onSaved={handleRefresh}
        />
      ) : null}
    </div>
  );
}
