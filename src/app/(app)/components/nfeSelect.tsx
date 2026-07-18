"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/lib/toast";
import formatarEmReal from "@/utils/formatarEmReal";
import axios, { isAxiosError } from "axios";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeft,
  ChevronsRight,
  Loader,
  Search,
} from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import type { NF } from "../(pages)/estoque/components/dialog-entrada/types";

interface NfeItem {
  id: number;
  modelo: string;
  numero: number;
  serie: number;
  chave_acesso: string;
  dataemissao: string;
  total_nfe: number;
  xmlStatus: string;
  xmlStatusLabel: string;
  destinatarioOuEmitente?: {
    nomerazaosocial?: string | null;
    cpfcnpj?: string | null;
  } | null;
}

interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  pageCount?: number;
}

interface NfeSelectProps {
  children?: ReactNode;
  OnSelect?: (value: NF) => void;
  setOpen?: (value: boolean) => void;
  open?: boolean;
}

const initialPagination: Pagination = {
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 0,
  pageCount: 0,
};

export default function NfeSelect({ children, OnSelect, setOpen, open }: NfeSelectProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pagination, setPagination] = useState<Pagination>(initialPagination);
  const [nfeItems, setNfeItems] = useState<NfeItem[]>([]);
  const [search, setSearch] = useState("");

  const handleGetNfes = async (pageNumber = 1, limit = pagination.limit, searchText = search) => {
    setIsLoading(true);
    try {
      const response = await axios.get("/api/fiscal/notas-recebidas", {
        params: {
          page: pageNumber,
          limit,
          search: searchText || undefined,
        },
      });

      const items = response.data.data ?? [];
      setNfeItems(items);
      setPagination({
        ...(response.data.pagination ?? initialPagination),
        pageCount: items.length,
      });
    } catch (error) {
      toast.error("Erro ao buscar notas fiscais", {
        description: isAxiosError(error)
          ? error.response?.data?.detail ?? error.response?.data?.error ?? error.message
          : "Não foi possível listar as notas fiscais de terceiros.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelect = async (nota: NfeItem) => {
    if (nota.xmlStatus !== "XML_COMPLETO") return;

    setSelectedId(nota.id);
    try {
      const xmlResponse = await axios.get(`/api/fiscal/notas-recebidas/${nota.id}/xml`, {
        responseType: "blob",
      });
      const formData = new FormData();
      formData.append(
        "file",
        new File([xmlResponse.data], `nfe-${nota.chave_acesso || nota.id}.xml`, {
          type: "application/xml",
        }),
      );

      const parsedResponse = await axios.post("/api/entradas/nf", formData);
      OnSelect?.({
        ...parsedResponse.data.parsed,
        documentoFiscalRecebidoId: nota.id,
      });
      setOpen?.(false);
      setSearch("");
    } catch (error) {
      toast.error("Erro ao selecionar nota fiscal", {
        description: isAxiosError(error)
          ? error.response?.data?.detail ?? error.response?.data?.error ?? error.message
          : "Não foi possível carregar os dados da nota fiscal.",
      });
    } finally {
      setSelectedId(null);
    }
  };

  useEffect(() => {
    if (open) void handleGetNfes(1, pagination.limit, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timeout = window.setTimeout(() => {
      void handleGetNfes(1, pagination.limit, search);
    }, 250);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        setOpen?.(nextOpen);
        if (!nextOpen) setSearch("");
      }}
      open={open}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="h-lvh min-w-screen max-h-[600px] p-0 overflow-hidden sm:max-w-[500px] sm:max-h-[600px] sm:w-[95vw] sm:min-w-0">
        <div className="flex h-full min-h-0 flex-col">
          <DialogHeader className="shrink-0 px-6 py-4 border-b-1">
            <DialogTitle>Selecione uma Nota Fiscal</DialogTitle>
            <DialogDescription></DialogDescription>
          </DialogHeader>
          <div className="h-full min-h-0 overflow-auto dark:bg-muted-foreground/5 px-6 py-10 space-y-2">
            <div className="flex flex-row items-center gap-2">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar por nota, chave ou emitente..."
                  className="pl-10"
                />
              </div>
            </div>

            <div className={`${isLoading && " opacity-100"} transition-all opacity-0 h-0.5 bg-slate-400 w-full overflow-hidden absolute left-0 right-0 top-0`}>
              <div className={`w-1/2 bg-primary h-full absolute left-0 rounded-lg -translate-x-[100%] ${isLoading && "animate-slideIn"}`}></div>
            </div>

            <Table className="text-[10px] mt-6">
              <TableHeader>
                <TableRow>
                  <TableCell>NOTA</TableCell>
                  <TableCell>EMITENTE</TableCell>
                  <TableCell className="hidden md:table-cell">EMISSÃO</TableCell>
                  <TableCell>VALOR</TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nfeItems.map((nota) => {
                  const selectable = nota.xmlStatus === "XML_COMPLETO";
                  return (
                    <TableRow
                      key={nota.id}
                      title={selectable ? "Selecionar nota fiscal" : nota.xmlStatusLabel}
                      className={`${selectable ? "hover:cursor-pointer" : "cursor-not-allowed opacity-50"}`}
                      onClick={() => void handleSelect(nota)}
                    >
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{nota.modelo} {nota.numero}</span>
                          <span className="text-muted-foreground">Série {nota.serie || "-"}</span>
                          <span className="text-muted-foreground">{nota.xmlStatusLabel}</span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate">
                        {nota.destinatarioOuEmitente?.nomerazaosocial || "-"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {nota.dataemissao ? new Date(nota.dataemissao).toLocaleDateString("pt-BR") : "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {formatarEmReal(nota.total_nfe || 0)}
                          {selectedId === nota.id ? <Loader className="h-3 w-3 animate-spin" /> : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        <DialogFooter>
          <div className="flex flex-row items-center pb-5 w-full h-full justify-center">
            <div className="text-xs text-muted-foreground flex flex-nowrap">
              <span>{pagination.total ? pagination.limit * (pagination.page - 1) + 1 : 0}</span> -{" "}
              <span>{pagination.limit * (pagination.page - 1) + (pagination.pageCount || 0)}</span>
              <span className="ml-1 hidden sm:block">de {pagination.total}</span>
              <Loader className={`ml-2 w-4 h-full animate-spin transition-all opacity-0 ${isLoading && "opacity-100"}`} />
            </div>

            <div className="flex items-center justify-center space-x-1 sm:space-x-3">
              <Button variant="outline" size="icon" className="hover:cursor-pointer" onClick={() => void handleGetNfes(1)} disabled={pagination.page === 1}>
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="hover:cursor-pointer" onClick={() => void handleGetNfes(pagination.page - 1)} disabled={pagination.page === 1}>
                <ChevronLeftIcon className="h-4 w-4" />
              </Button>
              <span className="text-xs font-medium text-nowrap">Pg. {pagination.page} de {pagination.totalPages || 1}</span>
              <Button variant="outline" size="icon" className="hover:cursor-pointer" onClick={() => void handleGetNfes(pagination.page + 1)} disabled={pagination.page === pagination.totalPages || pagination.totalPages === 0}>
                <ChevronRightIcon className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="hover:cursor-pointer" onClick={() => void handleGetNfes(pagination.totalPages)} disabled={pagination.page === pagination.totalPages || pagination.totalPages === 0}>
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
            <div>
              <Select>
                <SelectTrigger className="hover:cursor-pointer ml-2">
                  <SelectValue placeholder={pagination.limit}></SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem className="hover:cursor-pointer" value="20">{pagination.limit}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
