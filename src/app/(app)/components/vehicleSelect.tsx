"use client";

import { ReactNode, useEffect, useState } from "react";
import axios from "axios";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeft,
  ChevronsRight,
  Loader,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Pagination, Veiculo } from "../(pages)/veiculos/types";

interface VehicleSelectProps {
  children?: ReactNode;
  OnSelect?: (value: Veiculo) => void;
  setOpen?: (value: boolean) => void;
  open?: boolean;
  clienteId?: number | null;
  title?: string;
}

export default function VehicleSelect({
  children,
  OnSelect,
  setOpen,
  open,
  clienteId,
  title,
}: VehicleSelectProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });
  const [vehicleItems, setVehicleItems] = useState<Veiculo[]>([]);
  const [search, setSearch] = useState("");

  const handleGetVehicles = async (
    pageNumber = 1,
    limit = pagination.limit,
    searchText = search,
  ) => {
    setIsLoading(true);
    try {
      const response = await axios.get("/api/veiculos", {
        params: {
          page: pageNumber,
          limit,
          search: searchText || undefined,
          clienteId: clienteId ?? undefined,
        },
      });

      if (response.status === 200) {
        const { data } = response;
        setVehicleItems(Array.isArray(data.data) ? data.data : []);
        setPagination(data.pagination);
      }
    } catch {
      setVehicleItems([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      void handleGetVehicles(1, pagination.limit, search);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clienteId]);

  useEffect(() => {
    if (!open) return;
    const timeout = setTimeout(() => {
      void handleGetVehicles(1, pagination.limit, search);
    }, 250);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const start = pagination.limit * (pagination.page - 1) + (vehicleItems.length ? 1 : 0);
  const end = pagination.limit * (pagination.page - 1) + (pagination.pageCount || vehicleItems.length);

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        setOpen?.(nextOpen);
        if (!nextOpen) setSearch("");
      }}
      open={open}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="h-lvh min-w-screen max-h-[600px] overflow-hidden p-0 sm:max-h-[600px] sm:w-[95vw] sm:min-w-0 sm:max-w-[620px]">
        <div className="flex h-full min-h-0 flex-col">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle>{title ?? "Selecione um veículo"}</DialogTitle>
            <DialogDescription />
          </DialogHeader>

          <div className="relative h-full min-h-0 space-y-2 overflow-auto px-6 py-10 dark:bg-muted-foreground/5">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por placa, modelo, marca ou chassi..."
                className="pl-10"
              />
            </div>

            <div
              className={`absolute left-0 right-0 top-0 h-0.5 w-full overflow-hidden bg-slate-400 opacity-0 transition-all ${
                isLoading ? "opacity-100" : ""
              }`}
            >
              <div
                className={`absolute left-0 h-full w-1/2 -translate-x-full rounded-lg bg-primary ${
                  isLoading ? "animate-slideIn" : ""
                }`}
              />
            </div>

            <Table className="mt-6 text-[11px]">
              <TableHeader>
                <TableRow>
                  <TableCell>ID</TableCell>
                  <TableCell>VEÍCULO</TableCell>
                  <TableCell>PLACA</TableCell>
                  <TableCell className="hidden sm:table-cell">PROPRIETÁRIO</TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicleItems.map((v) => (
                  <TableRow
                    className="hover:cursor-pointer"
                    onClick={() => {
                      OnSelect?.(v);
                      setOpen?.(false);
                      setSearch("");
                    }}
                    key={v.id}
                  >
                    <TableCell>{v.id}</TableCell>
                    <TableCell className="max-w-[190px] truncate">
                      {[v.marca, v.modelo, v.ano].filter(Boolean).join(" ") || "-"}
                    </TableCell>
                    <TableCell>{v.placa || "-"}</TableCell>
                    <TableCell className="hidden max-w-[180px] truncate sm:table-cell">
                      {v.cliente?.nomerazaosocial || "Sem proprietário"}
                    </TableCell>
                  </TableRow>
                ))}
                {!isLoading && vehicleItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      Nenhum veículo encontrado.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </div>

        <DialogFooter>
          <div className="flex h-full w-full flex-row items-center justify-center pb-5">
            <div className="flex flex-nowrap text-xs text-muted-foreground">
              <span>{start}</span> - <span>{end}</span>
              <span className="ml-1 hidden sm:block">de {pagination.total}</span>
              <Loader className={`ml-2 h-full w-4 animate-spin opacity-0 transition-all ${isLoading ? "opacity-100" : ""}`} />
            </div>

            <div className="flex items-center justify-center space-x-1 sm:space-x-3">
              <Button
                variant="outline"
                size="icon"
                className="hover:cursor-pointer"
                onClick={() => handleGetVehicles(1, pagination.limit, search)}
                disabled={pagination.page === 1}
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="hover:cursor-pointer"
                onClick={() => handleGetVehicles(pagination.page - 1, pagination.limit, search)}
                disabled={pagination.page === 1}
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </Button>
              <span className="text-nowrap text-xs font-medium">
                Pg. {pagination.page} de {pagination.totalPages || 1}
              </span>
              <Button
                className="hover:cursor-pointer"
                variant="outline"
                size="icon"
                onClick={() => handleGetVehicles(pagination.page + 1, pagination.limit, search)}
                disabled={pagination.page === pagination.totalPages || pagination.totalPages === 0}
              >
                <ChevronRightIcon className="h-4 w-4" />
              </Button>
              <Button
                className="hover:cursor-pointer"
                variant="outline"
                size="icon"
                onClick={() => handleGetVehicles(pagination.totalPages, pagination.limit, search)}
                disabled={pagination.page === pagination.totalPages || pagination.totalPages === 0}
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>

            <Select
              value={String(pagination.limit)}
              onValueChange={(value) => {
                const limit = Number(value);
                setPagination((current) => ({ ...current, page: 1, limit }));
                void handleGetVehicles(1, limit, search);
              }}
            >
              <SelectTrigger className="ml-2 hover:cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem className="hover:cursor-pointer" value="20">
                  20
                </SelectItem>
                <SelectItem className="hover:cursor-pointer" value="50">
                  50
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
