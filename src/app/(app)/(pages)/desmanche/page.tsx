"use client";

import * as React from "react";
import axios from "axios";
import { toast } from "sonner";

import { TabelaLotes } from "./components/tabela-lotes";
import { Lote, Pagination } from "./types";

const paginationInicial: Pagination = {
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 1,
};

export default function DesmanchePage() {
  const [isLoading, setIsLoading] = React.useState(false);
  const [lotes, setLotes] = React.useState<Lote[]>([]);
  const [pagination, setPagination] = React.useState<Pagination>(paginationInicial);
  const [search] = React.useState("");

  const handleGetLotes = React.useCallback(async (pageNumber = 1, limit = pagination.limit, searchText = search) => {
    setIsLoading(true);
    try {
      const response = await axios.get("/api/lotes", {
        params: {
          page: pageNumber,
          limit,
          search: searchText || undefined,
        },
      });

      setLotes(response.data.data ?? []);
      setPagination(response.data.pagination ?? paginationInicial);
    } catch (error: any) {
      toast.error("Erro ao carregar lotes", {
        description: error?.response?.data?.error ?? error?.message,
      });
    } finally {
      setIsLoading(false);
    }
  }, [pagination.limit, search]);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      void handleGetLotes(1, pagination.limit, search);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [handleGetLotes, pagination.limit, search]);

  return (
    <div className="mx-auto space-y-6">
      <TabelaLotes
        lotes={lotes}
        pagination={pagination}
        search={search}
        isLoading={isLoading}
        handleGetLotes={handleGetLotes}
      />
    </div>
  );
}
