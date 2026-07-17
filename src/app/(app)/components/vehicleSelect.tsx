"use client";

import { ReactNode, useCallback, useEffect, useState } from "react";
import axios from "axios";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeft,
  ChevronsRight,
  Loader,
  Plus,
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
import { VeiculoDialog } from "../(pages)/veiculos/dialgo-veiculo/dialog-veiculo";
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
  const [openVeiculo, setOpenVeiculo] = useState(false);

  const handleGetVehicles = useCallback(async (
    pageNumber?: number,
    limit?: number,
    searchText?: string,
  ) => {
    setIsLoading(true);
    try {
      const response = await axios.get("/api/veiculos", {
        params: {
          page: pageNumber || 1,
          limit: limit || pagination.limit,
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
  }, [clienteId, pagination.limit]);

  useEffect(() => {
    if (!open) return;
    const timeout = setTimeout(() => {
      handleGetVehicles(pagination.page, pagination.limit, search);
    }, 250);
    return () => clearTimeout(timeout);
  }, [
    handleGetVehicles,
    open,
    pagination.limit,
    pagination.page,
    search,
  ]);

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (setOpen) {
          setOpen(nextOpen);
        }

        if (!nextOpen) {
          setSearch("");
        }
      }}
      open={open}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="h-lvh min-w-screen max-h-[600px] p-0 overflow-hidden sm:max-w-[500px] sm:max-h-[600px] sm:w-[95vw] sm:min-w-0">
        <div className="flex h-full min-h-0 flex-col">
          <DialogHeader className="shrink-0 px-6 py-4 border-b-1">
            <DialogTitle>{title ?? "Selecione um veículo"}</DialogTitle>
            <DialogDescription></DialogDescription>
          </DialogHeader>
          <div className="h-full min-h-0 overflow-auto dark:bg-muted-foreground/5 px-6 py-10 space-y-2">
            <div className="flex flex-row items-center gap-2">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPagination((current) => ({ ...current, page: 1 }));
                  }}
                  placeholder="Buscar por placa, modelo, marca ou chassi..."
                  className="pl-10"
                  value={search}
                />
              </div>
              <Button
                onClick={() => setOpenVeiculo(true)}
                variant={"outline"}
                className="text-xs hover:cursor-pointer"
              >
                <Plus />
                Novo
              </Button>
              <VeiculoDialog
                isOpen={openVeiculo}
                setIsOpen={(dialogOpen) => {
                  if (!dialogOpen) {
                    handleGetVehicles(1, pagination.limit, search);
                  }
                  setOpenVeiculo(dialogOpen);
                }}
                clienteId={clienteId ?? undefined}
                onRegister={() => handleGetVehicles(1, pagination.limit, search)}
              />
            </div>

            <div
              className={`${
                isLoading && " opacity-100"
              } transition-all opacity-0 h-0.5 bg-slate-400 w-full overflow-hidden absolute left-0 right-0 top-0`}
            >
              <div
                className={`w-1/2 bg-primary h-full  absolute left-0 rounded-lg  -translate-x-[100%] ${
                  isLoading && "animate-slideIn "
                } `}
              ></div>
            </div>

            <Table className="text-[11px] mt-6">
              <TableHeader>
                <TableRow>
                  <TableCell>ID</TableCell>
                  <TableCell>VEÍCULO</TableCell>
                  <TableCell>PLACA</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    PROPRIETÁRIO
                  </TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicleItems.map((v) => (
                  <TableRow
                    className="hover:cursor-pointer"
                    onClick={() => {
                      if (OnSelect) {
                        OnSelect(v);
                      }
                      if (setOpen) {
                        setOpen(false);
                        setSearch("");
                      }
                    }}
                    key={v.id}
                  >
                    <TableCell>{v.id}</TableCell>
                    <TableCell className="max-w-[160px] truncate">
                      {[v.marca, v.modelo, v.ano].filter(Boolean).join(" ") ||
                        "-"}
                    </TableCell>
                    <TableCell>{v.placa || "-"}</TableCell>
                    <TableCell className="hidden max-w-[140px] truncate sm:table-cell">
                      {v.cliente?.nomerazaosocial || "Sem proprietário"}
                    </TableCell>
                  </TableRow>
                ))}
                {!isLoading && vehicleItems.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Nenhum veículo encontrado.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </div>
        <DialogFooter>
          <div className="flex items-center pb-5 w-full h-full flex-row justify-center">
            <div className="text-xs text-muted-foreground flex flex-nowrap">
              <span>{pagination.limit * (pagination.page - 1) + 1}</span> -{" "}
              <span>
                {pagination.limit * (pagination.page - 1) +
                  (pagination.pageCount || 0)}
              </span>
              <span className="ml-1 hidden sm:block">
                de {pagination.total}
              </span>
              <Loader
                className={`ml-2 w-4 h-full animate-spin transition-all opacity-0 ${
                  isLoading && "opacity-100"
                }`}
              />
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
                onClick={() =>
                  handleGetVehicles(
                    pagination.page - 1,
                    pagination.limit,
                    search,
                  )
                }
                disabled={pagination.page === 1}
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </Button>
              <span className="text-xs font-medium text-nowrap">
                Pg. {pagination.page} de {pagination.totalPages || 1}
              </span>

              <Button
                className="hover:cursor-pointer"
                variant="outline"
                size="icon"
                onClick={() =>
                  handleGetVehicles(
                    pagination.page + 1,
                    pagination.limit,
                    search,
                  )
                }
                disabled={
                  pagination.page === pagination.totalPages ||
                  pagination.totalPages === 0
                }
              >
                <ChevronRightIcon className="h-4 w-4" />
              </Button>
              <Button
                className="hover:cursor-pointer"
                variant="outline"
                size="icon"
                onClick={() =>
                  handleGetVehicles(
                    pagination.totalPages,
                    pagination.limit,
                    search,
                  )
                }
                disabled={
                  pagination.page === pagination.totalPages ||
                  pagination.totalPages === 0
                }
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="">
              <Select>
                <SelectTrigger className="hover:cursor-pointer ml-2">
                  <SelectValue placeholder={pagination.limit}></SelectValue>
                </SelectTrigger>
                <SelectContent className="">
                  <SelectItem className="hover:cursor-pointer" value="20">
                    {pagination.limit}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
