"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
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

/** Abas do imóvel que um link pode abrir (qualquer outro valor cai na aba Geral). */
const ABAS_POR_LINK = ["geral", "midia", "anexos", "publicacao", "disponibilidade", "reservas", "locacoes-imobiliarias", "vendas-imobiliarias"];

export default function ImoveisPage() {
  const { can, ready } = useModulePermission();
  const router = useRouter();
  const searchParams = useSearchParams();
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
  } = useImoveisStatusCounter({ auto: ready && can("imoveis:visualizar") });

  const [selectedId, setSelectedId] = useState<number | undefined>(undefined);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  // Aba inicial e remontagem do diálogo quando ele é aberto por link (notificação).
  const [initialTab, setInitialTab] = useState<string | undefined>(undefined);
  const [linkOpenCount, setLinkOpenCount] = useState(0);

  // /imoveis?abrir=ID&aba=disponibilidade (link da central de notificações): abre o imóvel e
  // limpa a URL, para fechar o diálogo ou recarregar a página não reabrir o mesmo cadastro.
  const linkId = searchParams.get("abrir");
  const linkTab = searchParams.get("aba");
  useEffect(() => {
    if (!linkId) return;
    const id = Number(linkId);
    if (Number.isSafeInteger(id) && id > 0) {
      setInitialTab(linkTab && ABAS_POR_LINK.includes(linkTab) ? linkTab : undefined);
      setSelectedId(id);
      setIsDialogOpen(true);
      setLinkOpenCount((count) => count + 1);
    }
    router.replace("/imoveis", { scroll: false });
  }, [linkId, linkTab, router]);

  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  const fetchImoveis = useCallback(
    async (
      pageToUse: number,
      limitToUse: number,
      searchToUse: string,
      situacaoToUse: SituacaoImovel
    ) => {
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
    []
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
  }, [situacao, search, ready, can, pagination.limit, fetchImoveis]);

  const handleRefresh = () => {
    void fetchImoveis(pagination.page, pagination.limit, search, situacao);
    void fetchStatusCounts();
  };

  const handleOpenDialog = (id?: number) => {
    setInitialTab(undefined);
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
        onPageSizeChange={(limit) => setPagination(prev => ({ ...prev, page: 1, limit }))}
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
          key={`${selectedId ?? "new"}-${linkOpenCount}`}
          kind="imoveis"
          id={selectedId}
          initialTab={initialTab}
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
