"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MoreHorizontal,
  Edit,
  Send,
  Trash2Icon,
  Loader2,
  ChevronsLeft,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsRight,
  Loader,
  Plus,
} from "lucide-react";

import { Select, SelectValue, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Customer, DividaCliente, Pagination, Status } from "../types";
import { cn } from "@/lib/utils";
import formatarTelefone from "@/utils/formatarTelefone";
import Link from "next/link";
import { getStatusBadge } from "../utils";
import formatarEmReal from "@/utils/formatarEmReal";
import { CustomerDialog } from "./customerDialogRegister/customerDialog";
import DeleteAlert from "./deleteAlert";
import { useState } from "react";
import { useSession } from "next-auth/react";
import axios, { isAxiosError } from "axios";
import { toast } from "@/lib/toast";
import { ExportCustomersButton } from "./ExportCustomersButton";
import { formatCpfCnpj, getRankEmoji } from "./customerDialogRegister/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";

interface CustomerDataTableProps {
  handleGetCustomers: (pageNumber?: number, limit?: number, search?: string, status?: Status) => void;
  pagination: Pagination;
  search: string;
  status: Status;
  fetchStatusCounts: () => void;
  isLoading: boolean;
  customerItems: Customer[];
  selectedCustomerId?: number | undefined;
  setSelectedCustomerId: (value: number | undefined) => void;

  isOpen: boolean;
  setIsOpen: (value: boolean) => void;

  isAlertOpen: boolean;
  setIsAlertOpen: (value: boolean) => void;
}

/**
 * Quanto o cliente deve, na linha da listagem.
 *
 * Mostra o total em aberto e, quando ha atraso, destaca o vencido — que e o
 * numero que decide cobranca. Quem nao deve fica com um traco, para a coluna
 * nao virar uma parede de "R$ 0,00".
 *
 * O aviso de migrado importa: divida herdada de outro sistema pode estar num
 * cadastro que duplica um cliente antigo, e quem olha a lista precisa saber
 * disso antes de cobrar.
 */
function DividaCell({ divida }: { divida?: DividaCliente | null }) {
  if (!divida || divida.totalEmAberto <= 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  const vencido = divida.totalVencido > 0;

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span
        className={cn(
          "font-medium tabular-nums",
          vencido && "text-red-600 dark:text-red-400",
        )}
      >
        {formatarEmReal(divida.totalEmAberto)}
      </span>
      <span className="text-xs text-muted-foreground">
        {vencido
          ? `${formatarEmReal(divida.totalVencido)} vencido${
              divida.quantidadeVencida === 1 ? "" : "s"
            }`
          : `${divida.quantidadeEmAberto} a vencer`}
        {divida.temMigrado ? " · migrado" : ""}
      </span>
    </div>
  );
}

export default function CustomersDataTable({
  handleGetCustomers,
  pagination,
  search,
  status,
  fetchStatusCounts,
  isLoading,
  customerItems,
  selectedCustomerId,
  setSelectedCustomerId,
  isOpen,
  setIsOpen,
  isAlertOpen,
  setIsAlertOpen,
}: CustomerDataTableProps) {
  const { data: session } = useSession();
  const [isDeleting, setIsDeleting] = useState(false);
  const [idToDelete, setIdToDelete] = useState<number | null>(null);
  const canCreate = permissionSetHas((session?.user as any)?.permissoes, PERMS.CLIENTES_CRIAR);
  const canEdit = permissionSetHas((session?.user as any)?.permissoes, PERMS.CLIENTES_EDITAR);
  const canDelete = permissionSetHas((session?.user as any)?.permissoes, PERMS.CLIENTES_EXCLUIR);

  const truncate = (value: string | null | undefined, max: number) => {
    if (!value) return "-";

    return value.length > max ? `${value.slice(0, max)}...` : value;
  };

  const handleDeleteUser = async (id: number) => {
    if (!canDelete) return;
    setIsDeleting(true);
    try {
      const response = await axios.delete(`/api/customers/${id}`);
      if (response.status === 204) {
        toast("Usuário deletado!");
        handleGetCustomers(pagination.page, pagination.limit, search, status);
        fetchStatusCounts();
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Error", { description: error.response?.data.error });
      } else {
        toast.error("Erro ao deletar.");
      }
    } finally {
      setIsAlertOpen(false);
      setIdToDelete(null);
      setIsDeleting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="border-b-2 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Lista de Clientes</CardTitle>
            <CardDescription className="flex flex-col">
              <button
                onClick={() => {
                  handleGetCustomers(pagination.page, pagination.limit, search, status);
                  fetchStatusCounts();
                }}
                className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70 hover:cursor-pointer"
              >
                <span>Recarregar</span>
                <Loader2 width={12} className={isLoading ? "animate-spin" : ""} />
              </button>
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <ExportCustomersButton search={search} status={status} />

            {/* Botão Novo Cliente (ok manter assim) */}
            {canCreate ? (
            <CustomerDialog
              customerId={selectedCustomerId}
              isOpen={isOpen}
              setIsOpen={setIsOpen}
              setSelectedCustomerId={setSelectedCustomerId}
            >
              <Button className="hover:cursor-pointer">
                <Plus className="h-4 w-4" /> Cliente
              </Button>
            </CustomerDialog>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="min-h-[300px] -mt-[24px] px-4 pb-4 pt-0 relative">
        <div
          className={`${
            isLoading && " opacity-100"
          } transition-all opacity-0 h-0.5 bg-slate-400 w-full overflow-hidden absolute left-0 right-0 top-0`}
        >
          <div
            className={`w-1/2 bg-primary h-full absolute left-0 rounded-lg -translate-x-[100%] ${
              isLoading && "animate-slideIn "
            } `}
          />
        </div>

        <Table className="mt-6 text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>CPF/CNPJ</TableHead>
              <TableHead>Cidade/UF</TableHead>
              <TableHead className="text-right">Em aberto</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[50px]">Ações</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {customerItems.map((customer) => (
              <TableRow
                key={customer.id}
                onDoubleClick={() => setSelectedCustomerId(customer.id)}
                className="hover:cursor-pointer"
              >
                <TableCell>{customer.id}</TableCell>

                <TableCell>
                  <div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex max-w-[220px] items-center gap-1.5 font-medium">
                          <span className="truncate">{truncate(customer.nomerazaosocial, 28)}</span>
                          {customer.rank ? (
                            <span className="shrink-0" aria-label={`Classificação: ${customer.rank}`}>
                              {getRankEmoji(customer.rank)}
                            </span>
                          ) : null}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>{customer.nomerazaosocial}</TooltipContent>
                    </Tooltip>
                    <div className="text-sm text-muted-foreground">
                      {customer.tipopessoa === "FISICA" ? "PF" : "PJ"}
                    </div>
                  </div>
                </TableCell>

                <TableCell>
                  <div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="max-w-[220px] truncate text-sm">
                          {truncate(customer.email, 28)}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>{customer.email || "Sem e-mail"}</TooltipContent>
                    </Tooltip>
                    <div className="text-sm text-muted-foreground flex items-center">
                      {formatarTelefone(customer.telefone)}
                      {customer.telefone && (
                        <Link
                          target="_blank"
                          className="ml-2 group flex flex-row w-max gap-2 px-2 py-0.5 rounded-md items-center justify-center bg-primary text-accent text-center text-[10px] dark:text-white"
                          href={"http://wa.me/55" + customer.telefone}
                        >
                          Whatsapp
                          <Send size={10} />
                        </Link>
                      )}
                    </div>
                  </div>
                </TableCell>

                <TableCell className="font-mono text-sm">
                  {formatCpfCnpj(customer.cpfcnpj, customer.tipopessoa)}
                </TableCell>

                <TableCell className="text-sm">
                  {[customer.cidade, customer.estado].filter(Boolean).join("/") || "-"}
                </TableCell>

                <TableCell className="text-right text-sm">
                  <DividaCell divida={customer.divida} />
                </TableCell>

                <TableCell>{getStatusBadge(customer.status)}</TableCell>

                <TableCell>
                  {/* ✅ modal={false} ajuda quando vai abrir Dialog/Alert a partir do menu */}
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="h-8 w-8 p-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>

                    <DropdownMenuContent className="space-y-1" align="center">
                      {/* ✅ Editar via estado (não envolve DialogTrigger dentro do menu) */}
                      {canEdit ? (
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault();
                          setSelectedCustomerId(customer.id);
                          setIsOpen(true);
                        }}
                      >
                        <Edit className="h-4 w-4" />
                        <span>Editar</span>
                      </DropdownMenuItem>
                      ) : null}

                      {/* ✅ Excluir via estado (não envolve AlertDialogTrigger dentro do menu) */}
                      {canDelete ? (
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault();
                          setIdToDelete(customer.id);
                          setIsAlertOpen(true);
                        }}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2Icon className=" h-4 w-4" />
                        <span>Excluir</span>
                      </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* ✅ Alert fora do DropdownMenu para não desmontar ao fechar o menu */}
        <DeleteAlert
          idToDelete={idToDelete}
          isAlertOpen={isAlertOpen}
          setIsAlertOpen={(open) => {
            setIsAlertOpen(open);
            if (!open) setIdToDelete(null);
          }}
          handleDeleteUser={(id) => {
            // opcional: impede clique duplo
            if (isDeleting) return;
            handleDeleteUser(id);
          }}
        />

        <div className="flex items-center mt-4 justify-between">
          <div className="text-xs text-muted-foreground flex flex-nowrap">
            <span>{pagination.limit * (pagination.page - 1) + 1}</span> -{" "}
            <span>{pagination.limit * (pagination.page - 1) + (pagination.pageCount || 0)}</span>
            <span className="ml-1 hidden sm:block">de {pagination.total}</span>
            <Loader className={`w-4 h-full animate-spin transition-all opacity-0 ${isLoading && "opacity-100"}`} />
          </div>

          <div className="flex items-center justify-center space-x-1 sm:space-x-3">
            <Button
              variant="outline"
              size="sm"
              className="hover:cursor-pointer"
              onClick={() => handleGetCustomers(1, pagination.limit, search, status)}
              disabled={pagination.page === 1}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="hover:cursor-pointer"
              onClick={() => handleGetCustomers(pagination.page - 1, pagination.limit, search, status)}
              disabled={pagination.page === 1}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>

            <span className="text-[10px] sm:text-xs font-medium text-nowrap">
              Pg. {pagination.page} de {pagination.totalPages || 1}
            </span>

            <Button
              className="hover:cursor-pointer"
              variant="outline"
              size="sm"
              onClick={() => handleGetCustomers(pagination.page + 1, pagination.limit, search, status)}
              disabled={pagination.page === pagination.totalPages || pagination.totalPages === 0}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>

            <Button
              className="hover:cursor-pointer"
              variant="outline"
              size="sm"
              onClick={() => handleGetCustomers(pagination.totalPages, pagination.limit, search, status)}
              disabled={pagination.page === pagination.totalPages || pagination.totalPages === 0}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>

          <div>
            <Select>
              <SelectTrigger size="sm" className="hover:cursor-pointer ml-2">
                <SelectValue placeholder={pagination.limit} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem className="hover:cursor-pointer" value="20">
                  {pagination.limit}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
