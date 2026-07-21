"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  Calendar,
  Check,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeft,
  ChevronsRight,
  Loader,
  Loader2,
  MoreHorizontal,
  Eye,
  Plus,
  Trash2Icon,
} from "lucide-react";
import { formatDate } from "@/utils/formatDate";
import formatarEmReal from "@/utils/formatarEmReal";
import TransactionDialog from "./transactionDialog/transactionDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import DeleteAlert from "./deleteAlert";
import { toast } from "@/lib/toast";
import axios, { isAxiosError } from "axios";
import { Pagination, Tipo_transacao, Transaction } from "../types";
import { getCategoryIcon, getTypeColor } from "../utils";
import { ExportTransactionsButton } from "./ExportTransactionsButton";
import ConculidoAlert from "./concluidoAlert";
import SearchFilter from "./searchFilter";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";

type FluxoViewMode = "TODAS" | "A_RECEBER" | "A_PAGAR";

interface FinancialTableProps {
  dateTo: string;
  dateFrom: string;
  transactions: Transaction[];
  pagination: Pagination;
  handleGetTransactions: (
    pageNumber?: number,
    limit?: number,
    search?: string,
    dateFrom?: string,
    dateTo?: string,
    tipo?: Tipo_transacao | "",
    pendente?: boolean | "",
  ) => void;
  search: string;
  dateSearch: string;
  tipo: Tipo_transacao | "";
  rawTipo: Tipo_transacao | "";
  pendenteFilter?: boolean | "";
  viewMode?: FluxoViewMode;
  isLoading: boolean;
  setSearch: (value: string) => void;
  setTipo: (value: Tipo_transacao | "") => void;
  setDateFrom: (value: string) => void;
  setDateTo: (value: string) => void;
  setViewMode: (value: FluxoViewMode) => void;
  handleGetStatusCounter: () => void;
}

export default function FinancialTable({
  transactions,
  pagination,
  handleGetTransactions,
  search,
  dateSearch,
  tipo,
  rawTipo,
  pendenteFilter = "",
  viewMode = "TODAS",
  isLoading,
  setSearch,
  setTipo,
  setDateFrom,
  setDateTo,
  setViewMode,
  handleGetStatusCounter,
  dateTo,
  dateFrom,
}: FinancialTableProps) {
  const { data: session } = useSession();
  const [selectedTransactionId, setSelectedTransactionId] = useState<
    number | undefined
  >(undefined);
  const [isOpen, setIsOpen] = useState(false);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [selectedTransactionForPago, setSelectedTransactionForPago] =
    useState<Transaction | null>(null);
  const [isPagoDialogOpen, setIsPagoDialogOpen] = useState(false);
  const [, setIsDeleting] = useState(false);
  const canCreate = permissionSetHas(
    (session?.user as any)?.permissoes,
    PERMS.FINANCEIRO_CRIAR,
  );
  const canEdit = permissionSetHas(
    (session?.user as any)?.permissoes,
    PERMS.FINANCEIRO_EDITAR,
  );
  const canDelete = permissionSetHas(
    (session?.user as any)?.permissoes,
    PERMS.FINANCEIRO_EXCLUIR,
  );

  useEffect(() => {
    if (selectedTransactionId) setIsOpen(true);
  }, [selectedTransactionId]);

  const handleSetPago = async (id: number) => {
    if (!canEdit) return;
    toast(
      <div className="flex flex-row flex-nowrap items-center gap-1 ">
        {" "}
        <span>Marcando como concluído</span>{" "}
        <Loader2 className="w-3 h-3 animate-spin" />
      </div>,
    );
    try {
      const response = await axios.patch(`/api/transaction/${id}`, {
        pendente: false,
      });

      if (response.status === 200) {
        toast.success("Transação Atualizada");
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast(error.code, { description: error.message });
      }
    } finally {
      handleGetTransactions(
        pagination.page,
        pagination.limit,
        search,
        dateFrom,
        dateTo,
        tipo,
        pendenteFilter,
      );
    }
  };

  const handleDeleteTransaction = async (id: number) => {
    if (!canDelete) return;
    setIsDeleting(true);
    toast(
      <div className="flex gap-2 items-center flex-nowrap">
        <Loader className="animate-spin w-4" />
        <span className="text-nowrap">Deletando transação...</span>
      </div>,
    );
    try {
      const response = await axios.delete(`/api/transaction/${id}`, {});
      if (response.status === 204) {
        toast("Transação deletada!");
        handleGetTransactions(
          pagination.page,
          pagination.limit,
          search,
          dateFrom,
          dateTo,
          tipo,
          pendenteFilter,
        );
        handleGetStatusCounter();
      } else {
        toast.warning(`Status inesperado: ${response.status}`);
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Error", {
          description: error.response?.data.error,
        });
      }
    } finally {
      setIsDeleting(false);
      setIsAlertOpen(false);
    }
  };

  // ID estável para o Select de "itens por página"
  const limitUid = React.useId();
  const limitListboxId = `${limitUid}-limit-listbox`;

  const title =
    viewMode === "A_RECEBER"
      ? "Contas a Receber"
      : viewMode === "A_PAGAR"
        ? "Contas a Pagar"
        : "Lista de Transações";

  return (
    <Card className="">
      <CardHeader className="border-b-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-lg font-medium">{title}</CardTitle>
            <CardDescription className="flex flex-col">
              <button
                type="button"
                onClick={() => {
                  handleGetTransactions(
                    pagination.page,
                    pagination.limit,
                    search,
                    dateFrom,
                    dateTo,
                    tipo,
                    pendenteFilter,
                  );
                  handleGetStatusCounter();
                }}
                className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70 hover:cursor-pointer"
              >
                <span>Recarregar</span>
                <Loader2
                  width={12}
                  className={isLoading ? "animate-spin" : ""}
                />
              </button>
            </CardDescription>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <SearchFilter
                renderOnlyTrigger
                pagination={pagination}
                handleGetTransactions={handleGetTransactions}
                tipo={rawTipo}
                viewMode={viewMode}
                setViewMode={setViewMode}
                setSearch={setSearch}
                search={dateSearch}
                setTipo={setTipo}
                dateFrom={dateFrom}
                dateTo={dateTo}
                setDateFrom={setDateFrom}
                setDateTo={setDateTo}
                disableTipo={viewMode !== "TODAS"}
                lockedTipoLabel={
                  viewMode === "A_RECEBER"
                    ? "Somente receitas pendentes"
                    : viewMode === "A_PAGAR"
                      ? "Somente despesas pendentes"
                      : undefined
                }
              />
              <ExportTransactionsButton
                search={search}
                tipo={tipo}
                dateFrom={dateFrom}
                dateTo={dateTo}
                className="h-9 w-full hover:cursor-pointer sm:w-auto"
              />

              {canCreate ? (
                <TransactionDialog
                  open={isOpen}
                  setOpen={setIsOpen}
                  selectedTransactionId={selectedTransactionId}
                  setSelectedTransactionId={setSelectedTransactionId}
                >
                  <Button
                    size="sm"
                    className="h-9 w-full whitespace-nowrap hover:cursor-pointer sm:w-auto"
                    onClick={() => setSelectedTransactionId(undefined)}
                  >
                    <Plus className="h-4 w-4" />
                    Transação
                  </Button>
                </TransactionDialog>
              ) : null}
            </div>
          </div>
        </div>
        <div className="w-full flex items-center justify-center">
          <div className="inline-flex h-10 items-center justify-center rounded-md rounded-b-none bg-muted p-1 text-muted-foreground">
            <button
              type="button"
              onClick={() =>
                setViewMode(viewMode === "A_PAGAR" ? "TODAS" : "A_PAGAR")
              }
              className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm rounded-b-none px-3 py-1.5 text-sm font-medium transition-all cursor-pointer ${viewMode === "A_PAGAR"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "hover:bg-background/50 hover:text-foreground"
                }`}
            >
              A Pagar
            </button>
            <button
              type="button"
              onClick={() =>
                setViewMode(viewMode === "A_RECEBER" ? "TODAS" : "A_RECEBER")
              }
              className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm rounded-b-none px-3 py-1.5 text-sm font-medium transition-all cursor-pointer ${viewMode === "A_RECEBER"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "hover:bg-background/50 hover:text-foreground"
                }`}
            >
              A Receber
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="min-h-[300px] -mt-[24px] px-4 pb-4 pt-0 relative">
        {/* barra superior de loading */}
        <div
          className={`${isLoading && "opacity-100"
            } transition-all opacity-0 h-0.5 bg-slate-400 w-full overflow-hidden absolute left-0 right-0 top-0`}
        >
          <div
            className={`w-1/2 bg-primary h-full absolute left-0 rounded-lg -translate-x-[100%] ${isLoading && "animate-slideIn"
              }`}
          />
        </div>

        <Table className="text-xs mt-6">
          <TableHeader>
            <TableRow className="font-bold">
              <TableCell>Descrição</TableCell>
              <TableCell className="hidden md:table-cell">Data</TableCell>
              <TableCell className="hidden md:table-cell">Tipo</TableCell>
              <TableCell className="hidden md:table-cell">Categoria</TableCell>
              <TableCell className="hidden md:table-cell">Banco</TableCell>
              <TableCell className="hidden md:table-cell">Método</TableCell>
              <TableCell className="text-right">Valor</TableCell>
              <TableCell className="text-right">Ações</TableCell>
            </TableRow>
          </TableHeader>

          <TableBody>
            {transactions.map((t) => {
              // IDs estáveis para o menu da linha
              const triggerId = `row-${t.id}-menu-btn`;
              const menuId = `row-${t.id}-menu`;

              return (
                <TableRow
                  key={t.id}
                  onDoubleClick={() => setSelectedTransactionId(t.id)}
                  className="hover:cursor-pointer"
                >
                  <TableCell className="flex flex-row items-center gap-2">
                    <div className="rounded-full p-2 bg-primary/50">
                      {getCategoryIcon(t.categoria, t.categoria_dados?.icone)}
                    </div>
                    <div className="flex flex-col items-start">
                      {t.descricao}
                      {t.nomepagador && (
                        <span className="text-xs text-muted-foreground">
                          {t.nomepagador}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        ID: {t.id}
                      </span>
                      <span className="text-xs text-muted-foreground md:hidden">
                        {t.banco?.titulo ?? "Sem banco"} - {t.metodopagamento ?? "Método não definido"}
                      </span>
                      <span className="text-muted-foreground text-nowrap flex-nowrap flex justify-center items-center gap-2 md:hidden">
                        <Calendar className="w-[10px] h-[10px]" />
                        {Intl.DateTimeFormat("pt-BR", {
                          timeZone: "America/Fortaleza",
                          dateStyle: "short",
                        }).format(new Date(t.data))}
                      </span>
                    </div>
                  </TableCell>

                  <TableCell className="hidden md:table-cell">
                    {Intl.DateTimeFormat("pt-BR", {
                      timeZone: "America/Fortaleza",
                      dateStyle: "short",
                    }).format(new Date(t.data))}
                  </TableCell>
                  <TableCell
                    className={`hidden md:table-cell ${t.pendente && "text-primary font-semibold"}`}
                  >
                    {t.pendente && t.tipo === Tipo_transacao.DESPESA ? (
                      <span className=" flex flex-nowrap gap-1 items-center">
                        A PAGAR
                      </span>
                    ) : t.pendente && t.tipo === Tipo_transacao.RECEITA ? (
                      <span className=" flex flex-nowrap gap-1 items-center">
                        A RECEBER
                      </span>
                    ) : (
                      t.tipo
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {t.categoria}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {t.banco?.titulo ?? "Sem banco"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {t.metodopagamento ?? "Não definido"}
                  </TableCell>

                  <TableCell className={`text-right ${getTypeColor(t.tipo)}`}>
                    <div className="flex flex-col items-end">
                      {(t.tipo === "RECEITA" || t.tipo === "DEPOSITO") && "+ "}
                      {(t.tipo === "DESPESA" || t.tipo === "SAQUE") && "- "}
                      {formatarEmReal(t.valorLiquido)}
                      {t.valorLiquido !== t.valor && (
                        <span className="text-xs text-muted-foreground">
                          Bruto: {formatarEmReal(t.valor)}
                        </span>
                      )}
                    </div>
                  </TableCell>

                  <TableCell>
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

                      <DropdownMenuContent
                        id={menuId}
                        aria-labelledby={triggerId}
                        align="center"
                      >
                        <DropdownMenuItem
                          onClick={() => {
                            setSelectedTransactionId(t.id);
                            setIsOpen(true);
                          }}
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          Visualizar
                        </DropdownMenuItem>

                        {canEdit && t.pendente && (
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedTransactionForPago(t);
                              setIsPagoDialogOpen(true);
                            }}
                          >
                            <Check className="mr-2 h-4 w-4" />
                            Pago
                          </DropdownMenuItem>
                        )}

                        {canDelete ? (
                          <DeleteAlert
                            handleDeleteTransaction={handleDeleteTransaction}
                            isAlertOpen={isAlertOpen}
                            setIsAlertOpen={setIsAlertOpen}
                            idToDelete={t.id}
                          >
                            <DropdownMenuItem
                              onSelect={(e) => e.preventDefault()}
                              variant="destructive"
                            >
                              <Trash2Icon className="mr-2 h-4 w-4" />
                              Excluir
                            </DropdownMenuItem>
                          </DeleteAlert>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <div className="flex items-center mt-4 justify-between">
          <div className="text-xs text-muted-foreground mr-2 flex flex-nowrap">
            <span>{pagination.limit * (pagination.page - 1) + 1}</span>
            {" - "}
            <span>
              {pagination.limit * (pagination.page - 1) + transactions.length}
            </span>
          </div>

          <div className="flex items-center justify-center space-x-2">
            <Button
              variant="outline"
              size="icon"
              className="hover:cursor-pointer"
              onClick={() =>
                handleGetTransactions(
                  1,
                  pagination.limit,
                  search,
                  dateFrom,
                  dateTo,
                  tipo,
                  pendenteFilter,
                )
              }
              disabled={pagination.page === 1}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>

            <Button
              variant="outline"
              size="icon"
              className="hover:cursor-pointer"
              onClick={() =>
                handleGetTransactions(
                  pagination.page - 1,
                  pagination.limit,
                  search,
                  dateFrom,
                  dateTo,
                  tipo,
                  pendenteFilter,
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
                handleGetTransactions(
                  pagination.page + 1,
                  pagination.limit,
                  search,
                  dateFrom,
                  dateTo,
                  tipo,
                  pendenteFilter,
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
                handleGetTransactions(
                  pagination.totalPages,
                  pagination.limit,
                  search,
                  dateFrom,
                  dateTo,
                  tipo,
                  pendenteFilter,
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

          {/* Select de itens por página com IDs estáveis */}
          <div>
            <Select /* você pode controlar com value/onValueChange depois */>
              <SelectTrigger
                className="hover:cursor-pointer ml-2"
                aria-controls={limitListboxId}
              >
                <SelectValue placeholder={pagination.limit} />
              </SelectTrigger>
              <SelectContent id={limitListboxId}>
                <SelectItem className="hover:cursor-pointer" value="20">
                  {pagination.limit}
                </SelectItem>
                {/* adicione mais opções se quiser */}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>

      {selectedTransactionForPago && (
        <ConculidoAlert
          isAlertOpen={isPagoDialogOpen}
          setIsAlertOpen={setIsPagoDialogOpen}
          transaction={selectedTransactionForPago}
          onSuccess={() => {
            handleGetTransactions(
              pagination.page,
              pagination.limit,
              search,
              dateFrom,
              dateTo,
              tipo,
              pendenteFilter,
            );
            handleGetStatusCounter();
          }}
        />
      )}
    </Card>
  );
}
