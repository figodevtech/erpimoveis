"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import axios from "axios";
import Cards from "./components/cards";
import SearchFilter from "./components/searchfilter";
import ImoveisDataTable from "./components/imoveis-data-table";
import useImoveisStatusCounter from "./hooks/status-counter";
import { Imovel, Pagination, SituacaoImovel } from "./types";
import { useModulePermission } from "@/components/imobiliario/shared";
import { removeEntity } from "@/components/imobiliario/row-actions";

const EntityDialog = dynamic(() => import("@/components/imobiliario/entity-dialog"), {
  loading: () => <p role="status" className="p-3 text-sm">Carregando cadastro…</p>,
});

export default function ImoveisPage() {
  const { can, ready } = useModulePermission();
  const [imoveis, setImoveis] = useState<Imovel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [situacao, setSituacao] = useState<SituacaoImovel>(SituacaoImovel.TODOS);
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });

  const {
    statusCounts,
    totalImoveis,
    disponiveis,
    ocupados,
    loadingStatusCounter,
    fetchStatusCounts,
  } = useImoveisStatusCounter();

  const [selectedId, setSelectedId] = useState<number | undefined>(undefined);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  const fetchImoveis = useCallback(
    async (
      pageNumber?: number,
      limitNumber?: number,
      searchTerm?: string,
      situacaoFilter?: SituacaoImovel
    ) => {
      const pageToUse = pageNumber ?? pagination.page;
      const limitToUse = limitNumber ?? pagination.limit;
      const searchToUse = searchTerm !== undefined ? searchTerm : search;
      const situacaoToUse = situacaoFilter ?? situacao;

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

      if (situacaoToUse !== SituacaoImovel.TODOS) {
        params.set("situacao", situacaoToUse);
      }

      try {
        const response = await axios.get(`/api/imoveis?${params.toString()}`, {
          signal: controller.signal,
        });

        if (response.status === 200 && requestId === requestSequence.current) {
          const { items = [], total = 0 } = response.data;
          setImoveis(items);
          setPagination({
            page: pageToUse,
            limit: limitToUse,
            total,
            totalPages: Math.ceil(total / limitToUse),
          });
        }
      } catch (error) {
        if (!axios.isCancel(error) && requestId === requestSequence.current) {
          console.error("Erro ao buscar imóveis:", error);
        }
      } finally {
        if (requestId === requestSequence.current) {
          setIsLoading(false);
        }
      }
    },
    [pagination.page, pagination.limit, search, situacao]
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
    if (!ready || !can("imoveis:visualizar")) return;
    void fetchImoveis(1, pagination.limit, search, situacao);
  }, [situacao, search, ready, can, pagination.limit]);

  const handleRefresh = () => {
    void fetchImoveis(pagination.page, pagination.limit, search, situacao);
    void fetchStatusCounts();
  };

  const handleOpenDialog = (id?: number) => {
    setSelectedId(id);
    setIsDialogOpen(true);
  };

  if (ready && !can("imoveis:visualizar")) {
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
        totalImoveis={totalImoveis}
        disponiveis={disponiveis}
        ocupados={ocupados}
      />

      {/* Barra de Filtros e Busca Estilizada (Apenas Busca e Situação) */}
      <SearchFilter
        search={searchInput}
        setSearch={setSearchInput}
        situacao={situacao}
        setSituacao={setSituacao}
        onSearch={() => {
          const term = searchInput.trim();
          if (term === search) {
            void fetchImoveis(1, pagination.limit, term, situacao);
          } else {
            setSearch(term);
          }
        }}
        onClear={() => {
          setSearchInput("");
          if (search === "") {
            void fetchImoveis(1, pagination.limit, "", situacao);
          } else {
            setSearch("");
          }
        }}
      />

      {/* Tabela de Imóveis dentro do Card */}
      <ImoveisDataTable
        imoveis={imoveis}
        isLoading={isLoading}
        pagination={pagination}
        onPageChange={(page) => fetchImoveis(page, pagination.limit, search, situacao)}
        onPageSizeChange={(limit) => fetchImoveis(1, limit, search, situacao)}
        onRefresh={handleRefresh}
        onSelectImovel={(id) => handleOpenDialog(id)}
        onNewImovel={can("imoveis:criar") ? () => handleOpenDialog(undefined) : undefined}
        onDeleteImovel={
          can("imoveis:excluir")
            ? async (id) => {
                if (await removeEntity("imoveis", id)) handleRefresh();
              }
            : undefined
        }
        canCreate={can("imoveis:criar")}
        canEdit={can("imoveis:editar")}
      />

      {/* Diálogo de Cadastro / Edição */}
      {isDialogOpen ? (
        <EntityDialog
          key={selectedId ?? "new"}
          kind="imoveis"
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
