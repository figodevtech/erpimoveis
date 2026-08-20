"use client";

import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import type { Usuario } from "../lib/api";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import {
  ChevronsLeft,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  ChevronsRight,
  Loader2,
  MoreHorizontal,
  Eye,
  Edit3,
  Plus,
  Mail,
  Key,
} from "lucide-react";

type Props = {
  items: Usuario[];
  loading?: boolean;
  error?: string | null;
  onReload?: () => void;
  onNew?: () => void;
  onEdit: (u: Usuario) => void;
  onView: (u: Usuario) => void;
  onEnviarConvite?: (u: Usuario) => void;
  onDefinirSenha?: (u: Usuario) => void;
};

export function TabelaUsuarios({
  items,
  loading,
  error,
  onReload,
  onNew,
  onEdit,
  onView,
  onEnviarConvite,
  onDefinirSenha,
}: Props) {
  const { data: session } = useSession();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const canCreate = permissionSetHas((session?.user as any)?.permissoes, PERMS.USUARIOS_CRIAR);
  const canEdit = permissionSetHas((session?.user as any)?.permissoes, PERMS.USUARIOS_EDITAR);

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * limit;
  const end = Math.min(total, start + limit);
  const pageItems = items.slice(start, end);

  const linhasSkeleton = useMemo(
    () =>
      Array.from({ length: Math.min(5, limit) }).map((_, i) => (
        <TableRow key={`skeleton-${i}`} className="animate-pulse">
          <TableCell className="h-10">
            <div className="h-3 w-44 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-40 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-28 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-28 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-24 bg-muted rounded" />
          </TableCell>
          <TableCell className="text-right">
            <div className="h-6 w-6 bg-muted rounded-full ml-auto" />
          </TableCell>
        </TableRow>
      )),
    [limit]
  );

  return (
    <Card>
      <CardHeader className="border-b-2 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Usuários</CardTitle>
            <CardDescription className="flex items-center gap-2">
              {onReload ? (
                <button
                  onClick={onReload}
                  className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70"
                >
                  <span>Recarregar</span>
                  <Loader2 width={12} className={loading ? "animate-spin" : ""} />
                </button>
              ) : (
                <span className="text-foreground/60">
                  {total} usuário{total === 1 ? "" : "s"}
                  {error && (
                    <Badge variant="destructive" className="ml-2">
                      {error}
                    </Badge>
                  )}
                </span>
              )}
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            {onNew && canCreate && (
              <Button onClick={onNew} className="hover:cursor-pointer" size="sm">
                <Plus className="h-4 w-4" />
                Usuário
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="min-h-[190px] -mt-[24px] px-4 pb-4 pt-0 relative">
        <div
          className={`${
            loading ? "opacity-100" : ""
          } transition-all opacity-0 h-0.5 bg-slate-400 w-full overflow-hidden absolute left-0 right-0 top-0`}
        >
          <div
            className={`w-1/2 bg-primary h-full absolute left-0 rounded-lg -translate-x-[100%] ${
              loading ? "animate-slideIn" : ""
            }`}
          />
        </div>

        <Table className="mt-6">
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Usuário</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Setor</TableHead>
              <TableHead>Perfil</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {loading ? (
              linhasSkeleton
            ) : total === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                  Nenhum usuário encontrado. Clique em <b>Novo usuário</b> para cadastrar.
                </TableCell>
              </TableRow>
            ) : (
              pageItems.map((u) => (
                <TableRow key={String(u.id)} className="hover:cursor-default">
                  <TableCell className="font-medium">{u.nome}</TableCell>
                  <TableCell>{u.username ?? "—"}</TableCell>
                  <TableCell className="truncate">{u.email}</TableCell>
                  <TableCell>{u.setor ? <Badge variant="secondary">{u.setor.nome}</Badge> : "—"}</TableCell>
                  <TableCell>{u.perfil ? <Badge variant="outline">{u.perfil.nome}</Badge> : "—"}</TableCell>
                  <TableCell>
                    <Badge variant={u.ativo ? "default" : "destructive"}>{u.ativo ? "Ativo" : "Inativo"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onClick={() => onView(u)}>
                          <Eye className="h-4 w-4 mr-2" /> Visualizar
                        </DropdownMenuItem>
                        {canEdit ? (
                        <DropdownMenuItem onClick={() => onEdit(u)}>
                          <Edit3 className="h-4 w-4 mr-2" /> Editar
                        </DropdownMenuItem>
                        ) : null}
                        {onEnviarConvite && canEdit && (
                          <DropdownMenuItem onClick={() => onEnviarConvite(u)}>
                            <Mail className="h-4 w-4 mr-2" /> Refinir senha
                          </DropdownMenuItem>
                        )}
                        {onDefinirSenha && canEdit && (
                          <DropdownMenuItem onClick={() => onDefinirSenha(u)}>
                            <Key className="h-4 w-4 mr-2" /> Definir senha
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <div className="flex items-center mt-4 justify-between">
          <div className="text-xs text-muted-foreground mr-2 flex flex-nowrap">
            {total > 0 ? (
              <>
                <span>{start + 1}</span>
                {" - "}
                <span>{end}</span>
                <span className="ml-1 hidden sm:block">de {total}</span>
              </>
            ) : (
              <span>0 de 0</span>
            )}
          </div>

          <div className="flex items-center justify-center space-x-2">
            <Button
              variant="outline"
              size="icon"
              className="hover:cursor-pointer"
              onClick={() => setPage(1)}
              disabled={currentPage === 1 || total === 0}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="hover:cursor-pointer"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1 || total === 0}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
            <span className="text-xs font-medium text-nowrap">
              Pg. {currentPage} de {totalPages}
            </span>
            <Button
              className="hover:cursor-pointer"
              variant="outline"
              size="icon"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages || total === 0}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
            <Button
              className="hover:cursor-pointer"
              variant="outline"
              size="icon"
              onClick={() => setPage(totalPages)}
              disabled={currentPage === totalPages || total === 0}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>

          <div>
            <Select
              value={String(limit)}
              onValueChange={(v) => {
                const n = parseInt(v, 10) || 20;
                setLimit(n);
                setPage(1);
              }}
            >
              <SelectTrigger className="hover:cursor-pointer ml-2">
                <SelectValue placeholder={limit} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10" className="hover:cursor-pointer">
                  10
                </SelectItem>
                <SelectItem value="20" className="hover:cursor-pointer">
                  20
                </SelectItem>
                <SelectItem value="50" className="hover:cursor-pointer">
                  50
                </SelectItem>
                <SelectItem value="100" className="hover:cursor-pointer">
                  100
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

