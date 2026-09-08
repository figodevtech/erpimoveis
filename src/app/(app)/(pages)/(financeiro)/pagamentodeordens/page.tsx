"use client"
import { useRef, useState } from "react";
import OsTable from "./components/osTable";
import { Ordem, StatusOS } from "../../ordens/types";
import axios from "axios";
import { PaymentListFilters } from "../components/payments-filter-sheet";

export default function AssistentePagamento (){
    const requestId = useRef(0);
    const [ordens, setOrdens] = useState<Ordem[]>([])
    const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });
    const [isLoading, setIsLoading] = useState(false)
    const[search, ] = useState("")
    

    const handleGetOrdens = async (
      status: StatusOS,
      pageNumber?: number,
      limit?: number,
      search?: string,
      filters?: PaymentListFilters,
    ) => {
    const request = ++requestId.current;
    setIsLoading(true);
    try {
      const response = await axios.get("/api/ordens", {
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
          setor: filters?.setorId || "",
          prioridade: filters?.prioridade || "",
          alvoTipo: filters?.alvoTipo || "",
          responsavel: filters?.responsavelId || "",
          metodoPagamento: filters?.metodoPagamento || "",
          orcamentoMin: filters?.valorMin ?? "",
          orcamentoMax: filters?.valorMax ?? "",
        },
      });
      if (request === requestId.current && response.status === 200) {
        const { data } = response;
        setOrdens(data.items);
        setPagination({...pagination, limit:data.limit, page: data.page, totalPages:data.totalPages, total: data.total});
      }
    } catch {
    } finally {
      if (request === requestId.current) setIsLoading(false);
    }
  };



    return (

    <div className="p-y-4 space-y-4">
        <OsTable
        search={search}
        isLoading={isLoading}
        handleGetOrdens={handleGetOrdens}
        ordens={ordens}
        pagination={pagination}
        />
    </div>

    )
}
