"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pagination, Veiculo, Veiculo_tipos } from "./types";
import axios from "axios";
import TabelaVeiculos from "./tabela-veiculos";


export default function EstoquePage() {
  const [isLoading, setIsLoading] = useState(false);
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });
  const [search, setSearch] = useState("");
  const [selectedTipo] = useState<Veiculo_tipos | undefined>(undefined);
  const requestIdRef = useRef(0);

  const handleGetVehicles = useCallback(async (pageNumber = 1, limit = 20, search = "", tipo?: string) => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    try {
      const response = await axios.get("/api/veiculos", {
        params: {
          page: pageNumber,
          limit,
          search,
          tipo
        },
      })
      if (requestId !== requestIdRef.current) return;

      setVeiculos(response.data.data ?? []);
      setPagination(response.data.pagination);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setVeiculos([]);
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void handleGetVehicles(1, pagination.limit, search, selectedTipo);
    }, 300);

    return () => clearTimeout(timeout);
  }, [handleGetVehicles, pagination.limit, search, selectedTipo]);


  return (
    <div className="mx-auto space-y-6">
      {/* ✅ Header local removido (há um header global) */}
      

      <TabelaVeiculos
      selectedTipo={selectedTipo}
        handleGetVehicles={handleGetVehicles}
        isLoading={isLoading}
        veiculos={veiculos}
        pagination={pagination}
        search={search}
        setSearch={setSearch}
      />
    </div>
  );
}
