"use client";

import { useSession } from "next-auth/react";
import {
  ClipboardCheck,
  Eye,
  MoreHorizontal,
  Pause,
  PackageCheck,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { politicaAluguel } from "@/lib/alugueis/status";
import type { AluguelLista } from "../types";

export type AcaoAluguel =
  | "detalhes"
  | "editar"
  | "checklist-saida"
  | "pausar"
  | "reiniciar"
  | "encerrar"
  | "excluir";

/** Opções dinâmicas: status do aluguel (politicaAluguel) e permissões do usuário. */
export function RowActions({ aluguel, onAcao }: { aluguel: AluguelLista; onAcao: (acao: AcaoAluguel, aluguel: AluguelLista) => void }) {
  const { data: session } = useSession();
  const permissoes = (session?.user as any)?.permissoes;
  const podeEditar = permissionSetHas(permissoes, PERMS.ALUGUEIS_EDITAR);
  const podeExcluir = permissionSetHas(permissoes, PERMS.ALUGUEIS_EXCLUIR);
  const politica = politicaAluguel(aluguel.status);

  const editar = podeEditar && politica.podeEditar;
  const checklist = podeEditar && politica.podeChecklistSaida;
  const pausar = podeEditar && politica.podePausar;
  const reiniciar = podeEditar && politica.podeReiniciar;
  const encerrar = podeEditar && politica.podeEncerrar;
  const excluir = podeExcluir && politica.podeExcluir;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 hover:cursor-pointer" aria-label={`Ações do aluguel #${aluguel.id}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Ações</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onAcao("detalhes", aluguel)}>
          <Eye className="mr-2 h-4 w-4" /> Detalhes
        </DropdownMenuItem>
        {editar ? (
          <DropdownMenuItem onClick={() => onAcao("editar", aluguel)}>
            <Pencil className="mr-2 h-4 w-4" /> Editar
          </DropdownMenuItem>
        ) : null}
        {checklist ? (
          <DropdownMenuItem onClick={() => onAcao("checklist-saida", aluguel)}>
            <ClipboardCheck className="mr-2 h-4 w-4" /> Checklist de saída
          </DropdownMenuItem>
        ) : null}

        {pausar || reiniciar || encerrar ? <DropdownMenuSeparator /> : null}
        {pausar ? (
          <DropdownMenuItem onClick={() => onAcao("pausar", aluguel)}>
            <Pause className="mr-2 h-4 w-4" /> Pausar aluguel
          </DropdownMenuItem>
        ) : null}
        {reiniciar ? (
          <DropdownMenuItem onClick={() => onAcao("reiniciar", aluguel)}>
            <RotateCcw className="mr-2 h-4 w-4" /> Reiniciar
          </DropdownMenuItem>
        ) : null}
        {encerrar ? (
          <DropdownMenuItem onClick={() => onAcao("encerrar", aluguel)}>
            <PackageCheck className="mr-2 h-4 w-4" /> Encerrar aluguel
          </DropdownMenuItem>
        ) : null}

        {excluir ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => onAcao("excluir", aluguel)}>
              <Trash2 className="mr-2 h-4 w-4" /> Excluir
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
