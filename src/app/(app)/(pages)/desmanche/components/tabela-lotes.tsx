"use client";

import * as React from "react";
import axios, { isAxiosError } from "axios";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeft,
  ChevronsRight,
  Edit,
  Loader,
  Loader2,
  MoreHorizontal,
  Plus,
  Trash2Icon,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";

import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { DialogLote } from "../dialog-lote/dialog-lote";
import { Lote, Pagination } from "../types";

type TabelaLotesProps = {
  lotes: Lote[];
  pagination: Pagination;
  search: string;
  isLoading: boolean;
  handleGetLotes: (pageNumber?: number, limit?: number, search?: string) => void;
};

export function TabelaLotes({ lotes, pagination, search, isLoading, handleGetLotes }: TabelaLotesProps) {
  const { data: session } = useSession();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [selectedLoteId, setSelectedLoteId] = React.useState<number | undefined>(undefined);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [loteToDelete, setLoteToDelete] = React.useState<Lote | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const canCreate = permissionSetHas((session?.user as any)?.permissoes, PERMS.DESMANCHE_CRIAR);
  const canEdit = permissionSetHas((session?.user as any)?.permissoes, PERMS.DESMANCHE_EDITAR);
  const canDelete = permissionSetHas((session?.user as any)?.permissoes, PERMS.DESMANCHE_EXCLUIR);

  const refresh = () => handleGetLotes(pagination.page, pagination.limit, search);

  const abrirNovo = () => {
    if (!canCreate) return;
    setSelectedLoteId(undefined);
    setDialogOpen(true);
  };

  const abrirEdicao = (id?: number) => {
    if (!canEdit) return;
    if (!id) {
      toast.error("Lote sem ID válido para editar.");
      return;
    }
    setSelectedLoteId(id);
    setDialogOpen(true);
  };

  const abrirExcluir = (lote: Lote) => {
    if (!canDelete) return;
    setLoteToDelete(lote);
    setDeleteOpen(true);
  };

  const excluir = async () => {
    if (!loteToDelete?.id) return;

    setDeleting(true);
    try {
      await axios.delete(`/api/lotes/${loteToDelete.id}`);
      toast.success("Lote excluído com sucesso.");
      setDeleteOpen(false);
      setLoteToDelete(null);
      refresh();
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro ao excluir lote", {
          description: error.response?.data?.error ?? error.message,
        });
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card>
      <DialogLote
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setSelectedLoteId(undefined);
        }}
        loteId={selectedLoteId}
        onSaved={refresh}
      />

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setLoteToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lote?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação removerá o lote
              {loteToDelete?.placa ? ` de placa ${loteToDelete.placa}` : ""} e os vínculos de peças com ele.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void excluir();
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

      <CardHeader className="border-b pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Lista de lotes</CardTitle>
            <CardDescription>
              <button
                type="button"
                onClick={refresh}
                className="inline-flex items-center gap-1 text-foreground/50 hover:cursor-pointer hover:text-foreground/70"
              >
                <span>Recarregar</span>
                <Loader2 width={12} className={isLoading ? "animate-spin" : ""} />
              </button>
            </CardDescription>
          </div>

          {canCreate ? (
            <Button onClick={abrirNovo} className="cursor-pointer">
              <Plus className="mr-2 h-4 w-4" />
              Lote
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="relative -mt-[24px] min-h-[300px] px-4 pb-4 pt-0">
        <div
          className={`${isLoading && "opacity-100"} absolute left-0 right-0 top-0 h-0.5 w-full overflow-hidden bg-slate-400 opacity-0 transition-all`}
        >
          <div
            className={`absolute left-0 h-full w-1/2 -translate-x-[100%] rounded-lg bg-primary ${isLoading && "animate-slideIn"}`}
          />
        </div>

        <Table className="mt-6 text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead className="text-center">Placa</TableHead>
              <TableHead className="text-center">Descrição</TableHead>
              <TableHead className="hidden text-center md:table-cell">Fab/Mod</TableHead>
              <TableHead className="text-center">Peças</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {lotes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  Nenhum lote cadastrado.
                </TableCell>
              </TableRow>
            ) : (
              lotes.map((lote) => (
                <TableRow key={lote.id} className="hover:cursor-pointer">
                  <TableCell>{lote.id ?? "-"}</TableCell>
                  <TableCell className="text-center">{lote.placa ?? "-"}</TableCell>
                  <TableCell className="text-center">
                    {`${lote.marca ?? "-"} / ${`${lote.modelo ?? ""} ${lote.versao ?? ""}`.trim() || "-"}`}
                  </TableCell>
                  <TableCell className="hidden text-center md:table-cell">
                    {`${lote.ano ?? "-"}/${lote.ano_modelo ?? "-"}`}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline">{lote.pecas?.length ?? 0}</Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="center">
                        {canEdit ? (
                          <DropdownMenuItem className="hover:cursor-pointer" onClick={() => abrirEdicao(lote.id)}>
                            <Edit className="mr-2 h-4 w-4" />
                            Editar
                          </DropdownMenuItem>
                        ) : null}
                        {canDelete ? (
                          <DropdownMenuItem
                            className="hover:cursor-pointer"
                            variant="destructive"
                            onClick={() => abrirExcluir(lote)}
                          >
                            <Trash2Icon className="mr-2 h-4 w-4" />
                            Excluir
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex flex-nowrap text-xs text-muted-foreground">
            <span className="ml-1 hidden sm:block">de {pagination.total}</span>
            <Loader className={`h-full w-4 animate-spin opacity-0 transition-all ${isLoading && "opacity-100"}`} />
          </div>

          <div className="flex items-center justify-center space-x-1 sm:space-x-3">
            <Button
              variant="outline"
              size="sm"
              className="hover:cursor-pointer"
              onClick={() => handleGetLotes(1, pagination.limit, search)}
              disabled={pagination.page === 1}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="hover:cursor-pointer"
              onClick={() => handleGetLotes(pagination.page - 1, pagination.limit, search)}
              disabled={pagination.page === 1}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
            <span className="text-nowrap text-[10px] font-medium sm:text-xs">
              Pg. {pagination.page} de {pagination.totalPages || 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="hover:cursor-pointer"
              onClick={() => handleGetLotes(pagination.page + 1, pagination.limit, search)}
              disabled={pagination.page === pagination.totalPages || pagination.totalPages === 0}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="hover:cursor-pointer"
              onClick={() => handleGetLotes(pagination.totalPages, pagination.limit, search)}
              disabled={pagination.page === pagination.totalPages || pagination.totalPages === 0}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>

          <Select value={String(pagination.limit)} onValueChange={(value) => handleGetLotes(1, Number(value), search)}>
            <SelectTrigger size="sm" className="ml-2 hover:cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
