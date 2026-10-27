"use client";

import { useEffect, useRef, useState } from "react";
import { Produto, Pagination, Estoque_status, ProductListFilters } from "./types";
import axios from "axios";
import useContadorStatus from "./hooks/contador-status";
import Cards from "./components/cards";
import FiltroPesquisa from "./components/filtro-pesquisa";
import TabelaProdutos from "./components/tabela-produtos";
import { EMPTY_PRODUCT_FILTERS } from "./components/produto-filtros-sheet";
import { toast } from "@/lib/toast";

export default function EstoquePage() {
  const [status, setStatus] = useState<Estoque_status>(Estoque_status.TODOS);
  const [products, setProducts] = useState<Produto[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<number | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);

  const {
    statusCounts,
    loadingStatusCounter,
    totalProducts,
    fetchStatusCounts,
  } = useContadorStatus();

  const [isOpen, setIsOpen] = useState(false);
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    page: 1,
    limit: 50,
    totalPages: 0,
  });
  const [search, setSearch] = useState("");
  const [productFilters, setProductFilters] = useState<ProductListFilters>(EMPTY_PRODUCT_FILTERS);
  const latestProductsRequestRef = useRef(0);

  const handleGetProducts = async (
    pageNumber?: number,
    limit?: number,
    searchText?: string,
    statusValue?: Estoque_status,
    filters?: ProductListFilters,
  ) => {
    const requestId = ++latestProductsRequestRef.current;
    setIsLoading(true);
    try {
      const response = await axios.get("/api/products", {
        params: {
          page: pageNumber || 1,
          limit: limit || pagination.limit,
          search: searchText || undefined,
          status: statusValue || "TODOS",
          grupoId: filters?.grupoId || undefined,
          conservacao: filters?.conservacao || undefined,
          unidade: filters?.unidade || undefined,
          fabricante: filters?.fabricante || undefined,
          local: filters?.local || undefined,
          exibirPdv: filters?.exibirPdv || undefined,
          temEtiqueta: filters?.temEtiqueta || undefined,
          estoqueMin: filters?.estoqueMin || undefined,
          estoqueMax: filters?.estoqueMax || undefined,
          precoMin: filters?.precoMin || undefined,
          precoMax: filters?.precoMax || undefined,
        },
      });
      if (response.status === 200 && requestId === latestProductsRequestRef.current) {
        const { data } = response;
        setProducts(data.data);
        setPagination(data.pagination);
      }
    } catch (error) {
      if (requestId === latestProductsRequestRef.current) {
        console.log("Erro ao buscar Produtos:", error);
        const message = axios.isAxiosError(error)
          ? error.response?.data?.error ?? error.message
          : error instanceof Error
            ? error.message
            : "Erro inesperado.";
        toast.error("Não foi possível buscar os produtos.", { description: message });
      }
    } finally {
      if (requestId === latestProductsRequestRef.current) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void handleGetProducts(1, pagination.limit, search, status, productFilters);
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, productFilters]);

  // ✅ Mantém o duplo clique abrindo o diálogo de edição
  useEffect(() => {
    if (selectedProductId) {
      setIsOpen(true);
    }
  }, [selectedProductId]);

  return (
    <div className="mx-auto space-y-6">
      {/* ✅ Header local removido (há um header global) */}

      <Cards
        loadingStatusCounter={loadingStatusCounter}
        statusCounts={statusCounts}
        totalProducts={totalProducts}
      />

      <FiltroPesquisa
        search={search}
        setSearch={setSearch}
        setStatus={setStatus}
        status={status}
      />

      <TabelaProdutos
        // paginação/busca
        pagination={pagination}
        search={search}
        status={status}
        filters={productFilters}
        setFilters={setProductFilters}
        handleGetProducts={handleGetProducts}
        fetchStatusCounts={fetchStatusCounts}
        // dados
        isLoading={isLoading}
        products={products}
        // edição/novo produto
        selectedProductId={selectedProductId}
        setSelectedProductId={setSelectedProductId}
        isOpen={isOpen}
        setIsOpen={setIsOpen}
      />
    </div>
  );
}
