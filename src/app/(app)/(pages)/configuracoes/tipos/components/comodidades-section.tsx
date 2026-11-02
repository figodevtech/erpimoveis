// src/app/(app)/(pages)/configuracoes/tipos/components/comodidades-section.tsx
"use client";

import { useTipoAccess } from "./use-tipo-access";

import { useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/toast";
import {
  ChevronsLeft,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  ChevronsRight,
  Loader2,
  Plus,
  MoreHorizontal,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ComodidadeDialog, type TipoComodidade } from "./comodidadeDialog/comodidade-dialog";

const DEFAULT_LIMIT = 10;

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").trim();
}

export default function ComodidadesSection() {
  const { canCreate, canEdit, canDelete } = useTipoAccess("comodidades");
  const [comodidades, setComodidades] = useState<TipoComodidade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TipoComodidade | null>(null);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);

  const filtradas = useMemo(() => {
    const termo = normalize(busca);
    return termo ? comodidades.filter((c) => normalize(c.nome).includes(termo)) : comodidades;
  }, [comodidades, busca]);

  const total = filtradas.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [totalPages, page]);

  const start = (page - 1) * limit;
  const end = Math.min(total, start + limit);
  const pageItems = useMemo(() => filtradas.slice(start, end), [filtradas, start, end]);

  const linhasSkeleton = useMemo(
    () =>
      Array.from({ length: Math.min(5, limit) }).map((_, i) => (
        <TableRow key={`skeleton-${i}`} className="animate-pulse">
          <TableCell className="h-10">
            <div className="h-3 w-48 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-40 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-16 bg-muted rounded" />
          </TableCell>
          <TableCell className="text-right">
            <div className="h-6 w-10 bg-muted rounded-full ml-auto" />
          </TableCell>
        </TableRow>
      )),
    [limit]
  );

  async function loadComodidades() {
    try {
      setIsLoading(true);
      setErro(null);
      const res = await fetch("/api/tipos/comodidades", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Erro ao carregar tipos de comodidade");
      setComodidades(j.items ?? []);
    } catch (e: any) {
      const msg = e?.message || "Erro ao carregar tipos de comodidade";
      setErro(msg);
      toast.error(msg);
      setComodidades([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadComodidades();
  }, []);

  function openNovo() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEditar(c: TipoComodidade) {
    setEditing(c);
    setDialogOpen(true);
  }

  async function excluir(c: TipoComodidade) {
    if (!window.confirm(`Excluir o tipo "${c.nome}"? Os imóveis que já têm essa comodidade continuam com ela.`)) return;
    try {
      const res = await fetch(`/api/tipos/comodidades/${c.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Falha ao excluir tipo de comodidade");
      toast.success("Tipo de comodidade excluído.");
      await loadComodidades();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao excluir tipo de comodidade");
    }
  }

  return (
    <Card className="min-h-[360px]">
      <CardHeader className="border-b pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Tipos de comodidades</CardTitle>
            <CardDescription className="flex items-center gap-2">
              <button
                onClick={loadComodidades}
                className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70 text-xs"
              >
                <span>Recarregar</span>
                <Loader2 width={12} className={isLoading ? "animate-spin" : ""} />
              </button>
              <span className="text-foreground/60">
                {comodidades.length} tipo{comodidades.length === 1 ? "" : "s"}
              </span>
              {erro && (
                <Badge variant="destructive" className="ml-1">
                  {erro}
                </Badge>
              )}
            </CardDescription>
          </div>

          <Button size="sm" className="hover:cursor-pointer" onClick={openNovo} disabled={!canCreate}>
            <Plus className="mr-1 h-4 w-4" />
            Comodidade
          </Button>
        </div>
      </CardHeader>

      <CardContent className="min-h-[190px] -mt-[24px] px-4 pb-4 pt-0 sm:px-6 relative">
        <div
          className={`${
            isLoading ? "opacity-100" : ""
          } transition-all opacity-0 h-0.5 bg-slate-400 w-full overflow-hidden absolute left-0 right-0 top-0`}
        >
          <div
            className={`w-1/2 bg-primary h-full absolute left-0 rounded-lg -translate-x-[100%] ${
              isLoading ? "animate-slideIn" : ""
            }`}
          />
        </div>

        <div className="relative mt-6 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setPage(1);
            }}
            placeholder="Buscar comodidade..."
            className="pl-9"
          />
        </div>

        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              linhasSkeleton
            ) : total === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                  {busca ? (
                    "Nenhuma comodidade encontrada para a busca."
                  ) : (
                    <>
                      Nenhum tipo cadastrado. Clique em <b>+ Comodidade</b> para cadastrar.
                    </>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              pageItems.map((c) => (
                <TableRow key={c.id} className="hover:cursor-default">
                  <TableCell className="font-medium">{c.nome || "-"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[320px] truncate">
                    {c.descricao || "-"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={c.ativo ? "default" : "outline"}
                      className={c.ativo ? "" : "border-destructive bg-destructive"}
                    >
                      {c.ativo ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0 hover:cursor-pointer">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-32">
                        <DropdownMenuItem disabled={!canEdit} onClick={() => openEditar(c)}>
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={!canDelete}
                          onClick={() => excluir(c)}
                          className="text-destructive focus:text-destructive"
                        >
                          Excluir
                        </DropdownMenuItem>
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
              onClick={() => setPage(1)}
              disabled={page === 1 || total === 0}
              className="hover:cursor-pointer"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || total === 0}
              className="hover:cursor-pointer"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
            <span className="text-xs font-medium text-nowrap">
              Pg. {Math.min(page, totalPages)} de {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || total === 0}
              className="hover:cursor-pointer"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages || total === 0}
              className="hover:cursor-pointer"
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>

          <div>
            <Select
              value={String(limit)}
              onValueChange={(v) => {
                const n = parseInt(v, 10) || 10;
                setLimit(n);
                setPage(1);
              }}
            >
              <SelectTrigger className="hover:cursor-pointer ml-2">
                <SelectValue placeholder={limit} />
              </SelectTrigger>
              <SelectContent>
                {["10", "20", "50", "100"].map((n) => (
                  <SelectItem key={n} value={n} className="hover:cursor-pointer">
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>

      <ComodidadeDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        editing={editing}
        onSaved={() => void loadComodidades()}
      />
    </Card>
  );
}
