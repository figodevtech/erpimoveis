"use client";

import { useState } from "react";
import { Edit, Eye, MoreHorizontal, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
import { toast } from "@/lib/toast";
import { endpoint, type ModuleKind } from "./model";
import { requestJson } from "./shared";

/**
 * Exclui pela API do módulo. Quando o registro tem histórico, o backend
 * inativa em vez de apagar, e o aviso precisa dizer qual dos dois aconteceu.
 */
export async function removeEntity(kind: ModuleKind, id: number) {
  try {
    const result = await requestJson(endpoint(kind, id), { method: "DELETE" });
    notifyRemoval(result);
    return true;
  } catch (error) {
    toast.error("Erro ao excluir.", { description: (error as Error).message });
    return false;
  }
}

/** Diz se o registro sumiu de vez ou foi inativado, e quais vínculos impediram a exclusão. */
export function notifyRemoval(result: { inativado?: boolean; vinculos?: string[] } | null | undefined) {
  if (!result?.inativado) {
    toast.success("Cadastro excluído definitivamente.");
    return;
  }
  const vinculos = result.vinculos ?? [];
  toast.success("Cadastro inativado", {
    description: vinculos.length
      ? `Possui ${vinculos.join(", ").replace(/, ([^,]*)$/, " e $1")}; o histórico foi preservado e ele saiu do site.`
      : "Possui histórico vinculado, que foi preservado.",
  });
}

interface RowActionsProps {
  /** Sem permissão de editar, o item abre o cadastro só para consulta. */
  canEdit: boolean;
  onOpen: () => void;
  onDelete?: () => Promise<unknown>;
  deleteDescription?: string;
}

/** Menu de ações da linha, no mesmo padrão da listagem de clientes. */
export function RowActions({ canEdit, onOpen, onDelete, deleteDescription }: RowActionsProps) {
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  return (
    <>
      {/* modal={false} evita conflito ao abrir Dialog/Alert a partir do menu */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 w-8 p-0" onDoubleClick={(e) => e.stopPropagation()}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent className="space-y-1" align="center">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              onOpen();
            }}
          >
            {canEdit ? <Edit className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            <span>{canEdit ? "Editar" : "Visualizar"}</span>
          </DropdownMenuItem>

          {onDelete ? (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setIsAlertOpen(true);
              }}
              className="text-destructive focus:text-destructive"
            >
              <Trash2Icon className="h-4 w-4" />
              <span>Excluir</span>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Alert fora do DropdownMenu para não desmontar ao fechar o menu */}
      {onDelete ? (
        <AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
              <AlertDialogDescription>
                {deleteDescription ??
                  "Esta ação não pode ser desfeita. Registros com histórico serão inativados em vez de excluídos."}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AlertDialogCancel className="hover:cursor-pointer w-full sm:w-auto">
                Cancelar
              </AlertDialogCancel>

              <AlertDialogAction
                className="hover:cursor-pointer w-full sm:w-auto"
                disabled={isDeleting}
                onClick={async () => {
                  if (isDeleting) return;
                  setIsDeleting(true);
                  try {
                    await onDelete();
                  } finally {
                    setIsDeleting(false);
                    setIsAlertOpen(false);
                  }
                }}
              >
                Continuar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}
