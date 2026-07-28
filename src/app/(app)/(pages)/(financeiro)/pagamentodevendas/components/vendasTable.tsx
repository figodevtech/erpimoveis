"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Pagination } from "../../fluxodecaixa/types";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeft,
  ChevronsRight,
  DollarSign,
  FileText,
  Loader2,
  MoreHorizontal,
} from "lucide-react";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import formatarEmReal from "@/utils/formatarEmReal";
import { useEffect, useState } from "react";
import { VendaComItens, vendaStatus } from "../../../(vendas)/historicovendas/types";
import { formatDate } from "@/utils/formatDate";
import VendasFinancialDialog from "./vendasFinancialDialog/vendasFinancialDialog";
import { EmissaoNotaDialog } from "../../../ordens/components/dialogs/emissao-nota-dialog/emissao-nota-dialog";
import { useConfig } from "../../../config-context";
import { Badge } from "@/components/ui/badge";
import { calculateFinancialTotal } from "@/lib/financial-surcharge";
import {
  PaymentListFilters,
  PaymentsFilterSheet,
} from "../../components/payments-filter-sheet";

interface OsTableProps {
  vendas: VendaComItens[];
  pagination: Pagination;
  handleGetVendas: (
    status: vendaStatus,
    pageNumber?: number,
    limit?: number,
    search?: string,
    filters?: PaymentListFilters,
  ) => void;
  isLoading: boolean;
  search: string;
}

export default function VendasTable({ vendas, pagination, handleGetVendas, isLoading, search }: OsTableProps) {
  // ID estável para o Select de "itens por página"
  const [selectedStatus, setSelectedStatus] = useState<vendaStatus>(vendaStatus.PAGAMENTO);
  const [open, setOpen] = useState(false);
  const [openEmissao, setOpenEmissao] = useState(false);
  const [emissaoId, setEmissaoId] = useState<number | undefined>(undefined);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<PaymentListFilters>({
    cliente: "",
    notaNumero: "",
  });
  const limitUid = React.useId();
  const limitListboxId = `${limitUid}-os-limit-listbox`;
  const hasActiveFilters = Boolean(
    filters.cliente.trim() ||
      filters.notaNumero.trim() ||
      filters.dataInicio ||
      filters.dataFim,
  );

  useEffect(() => {
    handleGetVendas(selectedStatus, 1, pagination.limit, search, filters);
  }, [selectedStatus]);
  const config = useConfig();

  return (
    <Card className="bg-card">
      <CardHeader className="border-b-2 pb-4">
        <div className="relative flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <CardTitle>
              Vendas <span className="text-muted-foreground text-xs font-mono font-extralight">|EM PAGAMENTO</span>
            </CardTitle>
            <CardDescription className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  handleGetVendas(selectedStatus, pagination.page, pagination.limit, search, filters)
                }
                className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70"
              >
                <Loader2 className="h-3 w-3" />
                Recarregar
              </button>
              {hasActiveFilters && <span>Filtros ativos</span>}
            </CardDescription>
          </div>

          <div className="flex flex-1 items-center justify-center xl:absolute xl:left-1/2 xl:top-1/2 xl:-translate-x-1/2 xl:-translate-y-1/2">
            <div className="inline-flex h-auto items-center justify-center gap-1.5 rounded-2xl border bg-muted/40 p-1 backdrop-blur-sm">
              <button
                type="button"
                onClick={() => setSelectedStatus(vendaStatus.PAGAMENTO)}
                className={`inline-flex h-8 items-center justify-center whitespace-nowrap rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground ${selectedStatus === vendaStatus.PAGAMENTO
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "hover:bg-background/50 hover:text-foreground"
                  }`}
              >
                Abertas
              </button>
              <button
                type="button"
                onClick={() => setSelectedStatus(vendaStatus.FINALIZADA)}
                className={`inline-flex h-8 items-center justify-center whitespace-nowrap rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground ${selectedStatus === vendaStatus.FINALIZADA
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "hover:bg-background/50 hover:text-foreground"
                  }`}
              >
                Concluídas
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="hover:cursor-pointer"
                onClick={() => {
                  const cleared = { cliente: "", notaNumero: "" };
                  setFilters(cleared);
                  handleGetVendas(selectedStatus, 1, pagination.limit, search, cleared);
                }}
              >
                Limpar filtros
              </Button>
            )}
            <PaymentsFilterSheet
              open={filtersOpen}
              onOpenChange={setFiltersOpen}
              filters={filters}
              onFiltersChange={setFilters}
              onAplicar={() =>
                handleGetVendas(selectedStatus, 1, pagination.limit, search, filters)
              }
              onLimpar={() => {
                const cleared = { cliente: "", notaNumero: "" };
                setFilters(cleared);
                handleGetVendas(selectedStatus, 1, pagination.limit, search, cleared);
              }}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="min-h-[300px] -mt-[24px] px-4 pb-4 pt-0 relative flex flex-col justify-between">
        {/* barra superior de loading */}
        <div
          className={`${isLoading && "opacity-100"
            } transition-all opacity-0 h-0.5 bg-slate-400 w-full overflow-hidden absolute left-0 right-0 top-0`}
        >
          <div
            className={`w-1/2 bg-primary h-full absolute left-0 rounded-lg -translate-x-[100%] ${isLoading && "animate-slideIn "
              }`}
          />
        </div>
        <EmissaoNotaDialog
          onOpenChange={setOpenEmissao}
          open={openEmissao}
          vendaId={emissaoId}
        />
        <Table className="text-xs mt-6">
          <TableHeader>
            <TableRow className="font-bold">
              <TableCell>ID</TableCell>
              <TableCell>Nota</TableCell>
              <TableCell>Cliente</TableCell>
              <TableCell>Data</TableCell>
              <TableCell>Valor Total</TableCell>
              <TableCell>Status</TableCell>
              <TableCell></TableCell>
            </TableRow>
          </TableHeader>

          <TableBody>
            {vendas.length > 0 ? (
              vendas.map((v) => {
                // IDs estáveis por linha para o menu
                const triggerId = `os-row-${v.id}-menu-btn`;
                const menuId = `os-row-${v.id}-menu`;
                const totalFinanceiro = calculateFinancialTotal(
                  v.valortotal,
                  v.acrescimo_financeiro_tipo,
                  v.acrescimo_financeiro_valor,
                );

                return (
                  <TableRow key={v.id} className="hover:cursor-pointer">
                    {/* ... suas outras células (descrição, data etc.) aqui, se/quando tiver ... */}
                    <TableCell>{v.id}</TableCell>
                    <TableCell>{v.notaNumero ?? "-"}</TableCell>
                    <TableCell>{v.cliente.nomerazaosocial}</TableCell>
                    <TableCell>{formatDate(v.datavenda)}</TableCell>
                    <TableCell>{formatarEmReal(totalFinanceiro)}</TableCell>
                    <TableCell>
                      {totalFinanceiro > 0 ? (
                        (v.transacoes?.reduce((total, transaction) => total + Number(transaction?.valor ?? 0), 0) ?? 0) <
                        totalFinanceiro ? (
                          <Badge variant="secondary" className="font-bold text-amber-400">
                            Pagamento
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="font-bold text-green-400">
                            Faturado
                          </Badge>
                        )
                      ) : (
                        "Venda sem valor"
                      )}
                    </TableCell>

                    <TableCell className="flex justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            id={triggerId}
                            aria-controls={menuId}
                            variant="ghost"
                            className="h-8 w-8 p-0 cursor-pointer"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>

                        <DropdownMenuContent id={menuId} aria-labelledby={triggerId} className="space-y-1">
                          <VendasFinancialDialog
                            handleGetVendas={handleGetVendas}
                            open={open}
                            onOpenChange={setOpen}
                            vendaId={v.id}
                          >
                            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                              <DollarSign className="h-4 w-4" />
                              <span>Pagamento</span>
                            </DropdownMenuItem>
                          </VendasFinancialDialog>
                          {
                            config?.habilitar_emissao_nfe &&
                            (config?.emissao_nf_vendas_nao_pagas ? v.status === "PAGAMENTO" ||
                              v.status === "FINALIZADA" : v.status === "FINALIZADA") && (
                              <DropdownMenuItem
                                onClick={() => {
                                  setEmissaoId(v.id);
                                  setOpenEmissao(true);
                                }}
                              >
                                <FileText className="h-4 w-4" />
                                <span>Emitir NF</span>
                              </DropdownMenuItem>
                            )
                          }
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell className="text-center h-20" colSpan={99}>
                  Não existem vendas com este status
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <div className="flex items-center mt-4 justify-between">
          <div className="text-xs text-muted-foreground mr-2 flex flex-nowrap">
            <span>{pagination.limit * (pagination.page - 1) + 1}</span>
            {" - "}
            <span>{pagination.limit * (pagination.page - 1) + vendas.length}</span>
          </div>

          <div className="flex items-center justify-center space-x-2">
            <Button
              variant="outline"
              size="icon"
              className="hover:cursor-pointer"
              onClick={() => handleGetVendas(selectedStatus, 1, pagination.limit, search, filters)}
              disabled={pagination.page === 1}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>

            <Button
              variant="outline"
              size="icon"
              className="hover:cursor-pointer"
              onClick={() => handleGetVendas(selectedStatus, pagination.page - 1, pagination.limit, search, filters)}
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
              onClick={() => handleGetVendas(selectedStatus, pagination.page + 1, pagination.limit, search, filters)}
              disabled={pagination.page === pagination.totalPages || pagination.totalPages === 0}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>

            <Button
              className="hover:cursor-pointer"
              variant="outline"
              size="icon"
              onClick={() => handleGetVendas(selectedStatus, pagination.totalPages, pagination.limit, search, filters)}
              disabled={pagination.page === pagination.totalPages || pagination.totalPages === 0}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Select de itens por página com IDs estáveis */}
          <div>
            <Select>
              <SelectTrigger className="hover:cursor-pointer ml-2" aria-controls={limitListboxId}>
                <SelectValue placeholder={`${pagination.limit}`} />
              </SelectTrigger>
              <SelectContent id={limitListboxId}>
                <SelectItem className="hover:cursor-pointer" value="20">
                  {pagination.limit}
                </SelectItem>
                {/* adicione mais opções se desejar (10/20/50/100...) */}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
