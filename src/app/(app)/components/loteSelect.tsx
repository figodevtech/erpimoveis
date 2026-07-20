"use client";

import * as React from "react";
import axios, { isAxiosError } from "axios";
import {
  CarFront,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  Search,
} from "lucide-react";
import { toast } from "@/lib/toast";

import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type LoteSelectItem = {
  id: number;
  placa?: string | null;
  marca?: string | null;
  modelo?: string | null;
  versao?: string | null;
  ano?: number | null;
  ano_modelo?: number | null;
  tipo?: string | null;
  valor_compra?: number | null;
  imgUrl?: string | null;
  pecas?: Array<{ id: number }>;
};

type Pagination = {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  pageCount: number;
};

type LoteSelectProps = {
  children?: React.ReactNode;
  onSelect: (lote: LoteSelectItem) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  selectedLoteId?: number | null;
};

const PAGINATION_INITIAL: Pagination = {
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 1,
  pageCount: 0,
};

function descricaoLote(lote: LoteSelectItem) {
  return [lote.marca, lote.modelo, lote.versao].filter(Boolean).join(" ") || `Lote #${lote.id}`;
}

export default function LoteSelect({
  children,
  onSelect,
  open,
  setOpen,
  selectedLoteId,
}: LoteSelectProps) {
  const [isLoading, setIsLoading] = React.useState(false);
  const [items, setItems] = React.useState<LoteSelectItem[]>([]);
  const [pagination, setPagination] = React.useState(PAGINATION_INITIAL);
  const [search, setSearch] = React.useState("");

  const carregarLotes = React.useCallback(
    async (page = 1, searchText = search) => {
      setIsLoading(true);
      try {
        const response = await axios.get<{
          data: LoteSelectItem[];
          pagination: Pagination;
        }>("/api/products/lotes/select", {
          params: {
            page,
            limit: pagination.limit,
            search: searchText || undefined,
          },
        });
        setItems(response.data.data ?? []);
        setPagination(response.data.pagination ?? PAGINATION_INITIAL);
      } catch (error) {
        if (isAxiosError(error)) {
          toast.error("Erro ao carregar lotes", {
            description: error.response?.data?.error ?? error.message,
          });
        }
      } finally {
        setIsLoading(false);
      }
    },
    [pagination.limit, search],
  );

  React.useEffect(() => {
    if (!open) return;
    const timeout = window.setTimeout(() => void carregarLotes(1, search), 250);
    return () => window.clearTimeout(timeout);
  }, [carregarLotes, open, search]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setSearch("");
      }}
    >
      {children ? <DialogTrigger asChild>{children}</DialogTrigger> : null}
      <DialogContent className="h-svh min-w-screen overflow-hidden p-0 sm:max-h-[650px] sm:w-[95vw] sm:max-w-[680px] sm:min-w-0">
        <div className="flex h-full min-h-0 flex-col">
          <DialogHeader className="shrink-0 border-b px-4 py-4 sm:px-6">
            <DialogTitle>Selecione um lote</DialogTitle>
            <DialogDescription>
              Escolha o veículo de origem desta peça.
            </DialogDescription>
          </DialogHeader>

          <div className="relative flex min-h-0 flex-1 flex-col gap-4 px-4 py-4 sm:px-6">
            <div className="relative shrink-0">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por placa, marca, modelo ou versão..."
                className="pl-9"
              />
            </div>

            {isLoading ? (
              <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-muted">
                <div className="h-full w-1/2 animate-slideIn bg-primary" />
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
              <Table className="text-xs">
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="w-16">ID</TableHead>
                    <TableHead>Veículo</TableHead>
                    <TableHead className="hidden sm:table-cell">Placa</TableHead>
                    <TableHead className="hidden text-center md:table-cell">Ano</TableHead>
                    <TableHead className="text-center">Peças</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!isLoading && items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-28 text-center text-muted-foreground">
                        Nenhum lote encontrado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((lote) => {
                      const selecionado = Number(selectedLoteId) === lote.id;
                      return (
                        <TableRow
                          key={lote.id}
                          className="cursor-pointer"
                          data-state={selecionado ? "selected" : undefined}
                          onClick={() => {
                            onSelect(lote);
                            setOpen(false);
                          }}
                        >
                          <TableCell>#{lote.id}</TableCell>
                          <TableCell className="max-w-[220px]">
                            <div className="flex min-w-0 items-center gap-2">
                              <CarFront className="h-4 w-4 shrink-0 text-primary" />
                              <div className="min-w-0">
                                <p className="truncate font-medium">{descricaoLote(lote)}</p>
                                <p className="truncate text-[10px] text-muted-foreground sm:hidden">
                                  {lote.placa ?? "Sem placa"}
                                </p>
                              </div>
                              {selecionado ? <Badge variant="secondary">Atual</Badge> : null}
                            </div>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">{lote.placa ?? "-"}</TableCell>
                          <TableCell className="hidden text-center md:table-cell">
                            {lote.ano ?? "-"}/{lote.ano_modelo ?? "-"}
                          </TableCell>
                          <TableCell className="text-center">{lote.pecas?.length ?? 0}</TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t px-4 py-3 sm:px-6">
            <div className="flex w-full items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                {pagination.total} lote{pagination.total === 1 ? "" : "s"}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={pagination.page <= 1 || isLoading}
                  onClick={() => void carregarLotes(1)}
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={pagination.page <= 1 || isLoading}
                  onClick={() => void carregarLotes(pagination.page - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-20 text-center text-xs">
                  {isLoading ? (
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  ) : (
                    `Pg. ${pagination.page} de ${pagination.totalPages}`
                  )}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={pagination.page >= pagination.totalPages || isLoading}
                  onClick={() => void carregarLotes(pagination.page + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={pagination.page >= pagination.totalPages || isLoading}
                  onClick={() => void carregarLotes(pagination.totalPages)}
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
