"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Trash2Icon,
  ChevronsRight,
  ChevronRightIcon,
  ChevronLeftIcon,
  ChevronsLeft,
  Loader2,
  Edit,
  Loader,
  Plus,
  MoreHorizontal,
  ArrowLeftRight,
  Search,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Pagination, Veiculo, Veiculo_tipos } from "./types";
import { VeiculoDialog } from "./dialgo-veiculo/dialog-veiculo";
import { useState } from "react";
import { useSession } from "next-auth/react";
import CustomerSelect from "../../components/customerSelect";
import { toast } from "@/lib/toast";
import axios, { isAxiosError } from "axios";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";

interface TabelaVeiculosProps {
  selectedTipo?: Veiculo_tipos;
  isLoading: boolean;
  veiculos: Veiculo[];
  pagination: Pagination;
  search: string;
  setSearch: (value: string) => void;
  handleGetVehicles: (
    pageNumber?: number,
    limit?: number,
    search?: string,
    tipo?: Veiculo_tipos

  ) => void;
}

export default function TabelaVeiculos({
  handleGetVehicles,
  isLoading,
  veiculos,
  pagination,
  search,
  setSearch,
  selectedTipo,
}: TabelaVeiculosProps) {
  const { data: session } = useSession();
  const [openVeiculo, setOpenVeiculo] = useState(false);
  const [veiculoId, setSelectedVeiculoId] = useState<number | undefined>(undefined);
  const [veiculoTransferId, setVeiculoTransferId] = useState<number | undefined>(undefined);
  const [openCustomerSelect, setOpenCustomerSelect] = useState(false);
  const [, setTransferindo] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [veiculoToDelete, setVeiculoToDelete] = useState<Veiculo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const canCreate = permissionSetHas((session?.user as any)?.permissoes, PERMS.VEICULOS_CRIAR);
  const canEdit = permissionSetHas((session?.user as any)?.permissoes, PERMS.VEICULOS_EDITAR);
  const canDelete = permissionSetHas((session?.user as any)?.permissoes, PERMS.VEICULOS_EXCLUIR);


  const handleVehicleTransfer = async (novoDonoId: number) => {
    if (!canEdit) return;

    toast(<div className="flex felx-row gap-1 items-center"><Loader2 className="w-3 h-3 animate-spin" /><span>Transferindo veículo...</span> </div>);
    setTransferindo(true)
    try {
      const response = await axios.post(`/api/veiculos/${veiculoTransferId}/transferencia`, {
        novoDonoId: novoDonoId,
      });
      if (response.status === 200) {
        toast.success("Veículo transferido com sucesso!");
        handleGetVehicles(pagination.page, pagination.limit, search, selectedTipo);
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro ao transferir veículo", { description: error.response?.data.error });
      }
    } finally {
      setTransferindo(false)

    }
  };

  const handleOpenDeleteDialog = (veiculo: Veiculo) => {
    if (!canDelete) return;
    if (!veiculo.id) {
      toast.error("Veículo sem ID válido para excluir.");
      return;
    }

    setVeiculoToDelete(veiculo);
    setDeleteDialogOpen(true);
  };

  const handleDeleteVehicle = async () => {
    if (!veiculoToDelete?.id) return;

    setDeleting(true);
    toast(
      <div className="flex flex-row flex-nowrap items-center gap-2">
        <Loader className="w-4 animate-spin" />
        <span>Excluindo veículo...</span>
      </div>
    );

    try {
      const response = await axios.delete(`/api/veiculos/${veiculoToDelete.id}`);

      if (response.status === 200) {
        toast.success("Veículo excluído com sucesso!");
        handleGetVehicles(pagination.page, pagination.limit, search, selectedTipo);
        setDeleteDialogOpen(false);
        setVeiculoToDelete(null);
      } else {
        toast.warning(`Status inesperado: ${response.status}`);
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro ao excluir veículo", {
          description: error.response?.data?.error ?? error.message,
        });
      } else {
        toast.error("Erro inesperado ao excluir veículo.");
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card>
      <VeiculoDialog

        isOpen={openVeiculo}
        setIsOpen={(open) => {
          setOpenVeiculo(open);
          if (!open) {
            setSelectedVeiculoId(undefined);
            handleGetVehicles(pagination.page, pagination.limit, search, selectedTipo);
          }
        }}
        veiculoId={veiculoId}
        setSelectedVeiculoId={setSelectedVeiculoId}
        onRegister={() => handleGetVehicles(pagination.page, pagination.limit, search, selectedTipo)}
      />
      <CustomerSelect
        open={openCustomerSelect}
        setOpen={setOpenCustomerSelect}
        OnSelect={(c) => handleVehicleTransfer(c.id)}
      />
      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) setVeiculoToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Deletará o veículo
              {veiculoToDelete?.placa ? ` de placa ${veiculoToDelete.placa}` : ""} e os dados atrelados a ele.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="hover:cursor-pointer" disabled={deleting}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="hover:cursor-pointer"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                handleDeleteVehicle();
              }}
            >
              {deleting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Excluindo
                </span>
              ) : (
                "Continuar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <CardHeader className="border-b-2 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Lista de Veículos</CardTitle>
            <CardDescription>
              <button
                onClick={() => {
                  handleGetVehicles(pagination.page, pagination.limit, search, selectedTipo);
                }}
                className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70 hover:cursor-pointer"
              >
                <span>Recarregar</span>
                <Loader2 width={12} className={isLoading ? "animate-spin" : ""} />
              </button>
            </CardDescription>
          </div>

          <div className="flex min-w-0 items-center gap-2">
            <div className="relative hidden w-[360px] md:block">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar veículo ou proprietário..."
                className="pl-8 pr-9"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
                  aria-label="Limpar busca"
                  title="Limpar busca"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>

            {canCreate ? (
            <Button onClick={() => setOpenVeiculo(true)} className="cursor-pointer">
              <Plus className="mr-2 h-4 w-4" />
              Veículo
            </Button>
            ) : null}


          </div>
        </div>

        <div className="relative mt-3 w-full md:hidden">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar veículo ou proprietário..."
            className="pl-8 pr-9"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
              aria-label="Limpar busca"
              title="Limpar busca"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="min-h-[300px] -mt-[24px] px-4 pb-4 pt-0 relative">
        <div
          className={`${isLoading && " opacity-100"
            } transition-all opacity-0 h-0.5 bg-slate-400 w-full overflow-hidden absolute left-0 right-0 top-0`}
        >
          <div
            className={`w-1/2 bg-primary h-full absolute left-0 rounded-lg -translate-x-[100%] ${isLoading && "animate-slideIn "
              }`}
          />
        </div>

        <Table className="mt-6 text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead className="text-center">Placa</TableHead>
              <TableHead className="text-center">Descrição</TableHead>
              <TableHead className="text-center">Mod/Fab</TableHead>
              <TableHead className="text-center">Proprietário</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {veiculos?.map((v, idx) => {
              const id = typeof v.id === "number" ? v.id : undefined;
              const canAct = !!id;

              return (
                <TableRow
                  key={id ?? `row-${idx}`}
                  className="hover:cursor-pointer"
                >
                  <TableCell>{id ?? "-"}</TableCell>

                  <TableCell className="text-center">{v.placa ?? "-"}</TableCell>

                  <TableCell className="text-center">{`${v.marca ?? "-"} / ${`${v.modelo ?? ""} ${v.versao ?? ""}`.trim() || "-"
                    }`}</TableCell>
                  <TableCell className="text-center">{`${v.ano ?? "-"}/${v.ano_modelo ?? "-"}`}</TableCell>
                  <TableCell className="text-center">{v.cliente?.nomerazaosocial ?? "-"}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          className="h-8 w-8 p-0 cursor-pointer"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>

                      <DropdownMenuContent align="center">
                        {canEdit ? (
                        <DropdownMenuItem
                          className="hover:cursor-pointer"
                          onClick={() => { setSelectedVeiculoId(v.id); setOpenVeiculo(true); }}
                          disabled={!canAct}
                        >
                          <Edit className="mr-2 h-4 w-4" />
                          Editar
                        </DropdownMenuItem>
                        ) : null}
                        {canEdit ? (
                        <DropdownMenuItem
                          onClick={() => { setOpenCustomerSelect(true); setVeiculoTransferId(v?.id) }}
                          className="hover:cursor-pointer"
                        >
                          <ArrowLeftRight />
                          Transferir Propriedade
                        </DropdownMenuItem>
                        ) : null}

                        {canDelete ? (
                        <DropdownMenuItem
                          className="hover:cursor-pointer"
                          variant="destructive"
                          disabled={!canAct}
                          onClick={() => handleOpenDeleteDialog(v)}
                        >
                          <Trash2Icon className="mr-2 h-4 w-4" />
                          Excluir
                        </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {/* Rodapé */}
        <div className="flex items-center mt-4 justify-between">
          <div className="text-xs text-muted-foreground flex flex-nowrap">
            <span className="ml-1 hidden sm:block">de {pagination?.total}</span>
            <Loader
              className={`w-4 h-full animate-spin transition-all opacity-0 ${isLoading && "opacity-100"
                }`}
            />
          </div>

          <div className="flex items-center justify-center space-x-1 sm:space-x-3">
            <Button
              variant="outline"
              size="sm"
              className="hover:cursor-pointer"
              onClick={() =>
                handleGetVehicles(1, pagination?.limit, search,)
              }
              disabled={pagination.page === 1}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
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
            <span className="text-[10px] sm:text-xs font-medium text-nowrap">
              Pg. {pagination.page} de {pagination.totalPages || 1}
            </span>
            <Button
              className="hover:cursor-pointer"
              variant="outline"
              size="sm"
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
              size="sm"
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

          <div>
            <Select>
              <SelectTrigger size="sm" className="hover:cursor-pointer ml-2">
                <SelectValue placeholder={pagination.limit}></SelectValue>
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
