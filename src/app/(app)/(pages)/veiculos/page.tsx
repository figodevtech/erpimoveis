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
  const buscaAnterior = useRef(search);
  const requisicao = useRef<AbortController | null>(null);
  const [selectedTipo] = useState<Veiculo_tipos | undefined>(undefined);
  const requestIdRef = useRef(0);

  const handleGetVehicles = useCallback(async (pageNumber = 1, limit = 20, search = "", tipo?: string) => {
    const requestId = ++requestIdRef.current;
    requisicao.current?.abort();
    const controller = new AbortController();
    requisicao.current = controller;
    setIsLoading(true);
    try {
      const response = await axios.get("/api/veiculos", {
        signal: controller.signal,
        params: {
          page: pageNumber,
          limit,
          search,
          tipo
        },
      })
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;

      setVeiculos(response.data.data ?? []);
      setPagination(response.data.pagination);
    } catch {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      setVeiculos([]);
    } finally {
      if (!controller.signal.aborted && requestId === requestIdRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const atraso = buscaAnterior.current === search ? 0 : 300;
    buscaAnterior.current = search;
    const timeout = setTimeout(() => {
      void handleGetVehicles(1, pagination.limit, search, selectedTipo);
    }, atraso);

    return () => { clearTimeout(timeout); requisicao.current?.abort(); };
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
