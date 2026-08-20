"use client"
import { useEffect, useState } from "react";
import axios from "axios";
import { VendaComItens, vendaStatus } from "../../(vendas)/historicovendas/types";
import VendasTable from "./components/vendasTable";
import { PaymentListFilters } from "../components/payments-filter-sheet";

export default function AssistentePagamentoVendas (){
    const [vendas, setVendas] = useState<VendaComItens[]>([])
    const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });
    const [isLoading, setIsLoading] = useState(false)
    const[search, ] = useState("")
    

    const handleGetVendas = async (
      status: vendaStatus,
      pageNumber?: number,
      limit?: number,
      search?: string,
      filters?: PaymentListFilters,
    ) => {
    setIsLoading(true);
    try {
      const response = await axios.get("/api/venda", {
        params: {
          page: pageNumber || 1,
          limit: limit || pagination.limit,
          q: search || "",
          status: status,
          cliente: filters?.cliente || "",
          notaNumero: filters?.notaNumero || "",
          dateFrom: filters?.dataInicio
            ? filters.dataInicio.toISOString().slice(0, 10)
            : "",
          dateTo: filters?.dataFim
            ? filters.dataFim.toISOString().slice(0, 10)
            : "",
          apenasMinhas: filters?.apenasMinhas ? "1" : "",
          canal: filters?.canal || "",
          categoriaVendaId: filters?.categoriaVendaId || "",
          vendedorId: filters?.vendedorId || "",
          valorMin: filters?.valorMin ?? "",
          valorMax: filters?.valorMax ?? "",
        },
      });
      if (response.status === 200) {
        const { data } = response;
        setVendas(data.data);
        setPagination({...pagination, limit:data.pagination.limit, page: data.pagination.page, totalPages:data.pagination.totalPages, total: data.pagination.total});
      }
    } catch {
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(()=> {
    handleGetVendas(vendaStatus.PAGAMENTO);
  },[])

    return (

    <div className="p-y-4 space-y-4">
        <VendasTable
        search={search}
        isLoading={isLoading}
        handleGetVendas={handleGetVendas}
        vendas={vendas}
        pagination={pagination}
        />
    </div>

    )
}
