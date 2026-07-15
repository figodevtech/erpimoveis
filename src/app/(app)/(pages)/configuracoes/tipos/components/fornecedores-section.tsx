// src/app/(app)/(pages)/configuracoes/tipos/components/fornecedores-section.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/toast";
import {
  ChevronsLeft,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  ChevronsRight,
  Loader2,
  MoreHorizontal,
  Plus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import FornecedorDialog from "./fornecedorDialog";

type Fornecedor = {
  id: number;
  cpfcnpj: string;
  nomerazaosocial: string;
  nomefantasia: string | null;
  endereco: string | null;
  cidade: string | null;
  endereconumero: string | null;
  codigomunicipio: string | null;
  bairro: string | null;
  estado: string | null;
  cep: string | null;
  contato: string | null;
  ativo: boolean | null;
};

const DEFAULT_LIMIT = 10;

export default function FornecedoresSection() {
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Fornecedor | null>(null);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);

  const total = fornecedores.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [totalPages, page]);

  const start = (page - 1) * limit;
  const end = Math.min(total, start + limit);
  const pageItems = useMemo(() => fornecedores.slice(start, end), [fornecedores, start, end]);

  const linhasSkeleton = useMemo(
    () =>
      Array.from({ length: Math.min(5, limit) }).map((_, i) => (
        <TableRow key={`skeleton-${i}`} className="animate-pulse">
          <TableCell className="h-10">
            <div className="h-3 w-44 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-32 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-28 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-36 bg-muted rounded" />
          </TableCell>
          <TableCell className="text-center">
            <div className="h-5 w-16 bg-muted rounded-full mx-auto" />
          </TableCell>
          <TableCell className="text-right">
            <div className="h-6 w-10 bg-muted rounded-full ml-auto" />
          </TableCell>
        </TableRow>
      )),
    [limit]
  );

  async function loadFornecedores() {
    try {
      setIsLoading(true);
      setErro(null);
      const res = await fetch("/api/tipos/fornecedores", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Erro ao carregar fornecedores");

      const items: Fornecedor[] = (json.items ?? json.data ?? []).map((f: any) => ({
        id: Number(f.id),
        cpfcnpj: String(f.cpfcnpj ?? ""),
        nomerazaosocial: String(f.nomerazaosocial ?? ""),
        nomefantasia: (f.nomefantasia as string | null) ?? null,
        endereco: (f.endereco as string | null) ?? null,
        endereconumero: (f.endereconumero as string | null) ?? null,
        cidade: (f.cidade as string | null) ?? null,
        codigomunicipio: (f.codigomunicipio as string | null) ?? null,
        bairro: (f.bairro as string | null) ?? null,
        estado: (f.estado as string | null) ?? null,
        cep: (f.cep as string | null) ?? null,
        contato: (f.contato as string | null) ?? null,
        ativo: typeof f.ativo === "boolean" ? (f.ativo as boolean) : true,
      }));
      setFornecedores(items);
    } catch (err: any) {
      const msg = err?.message || "Erro ao carregar fornecedores";
      setErro(msg);
      toast.error(msg);
      setFornecedores([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadFornecedores();
  }, []);

  function openEditar(f: Fornecedor) {
    setEditing(f);
    setDialogOpen(true);
  }

  return (
    <Card className="min-h-[460px]">
      <CardHeader className="border-b pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Fornecedores</CardTitle>
            <CardDescription className="flex items-center gap-2">
              <button
                onClick={loadFornecedores}
                className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70 text-xs"
              >
                <span>Recarregar</span>
                <Loader2 width={12} className={isLoading ? "animate-spin" : ""} />
              </button>
              <span className="text-foreground/60">
                {total} fornecedor{total === 1 ? "" : "es"}
              </span>
              {erro && (
                <Badge variant="destructive" className="ml-1">
                  {erro}
                </Badge>
              )}
            </CardDescription>
          </div>

          <FornecedorDialog
            dialogOpen={dialogOpen}
            setDialogOpen={setDialogOpen}
            loadFornecedores={loadFornecedores}
            fornecedorToEdit={editing}
            setFornecedorToEdit={setEditing}
          ><Button size="sm" className="hover:cursor-pointer">
            <Plus className="mr-1 h-4 w-4" />
            Fornecedor
          </Button></FornecedorDialog>
        </div>
      </CardHeader>

      <CardContent className="min-h-[190px] -mt-[24px] px-4 pb-4 pt-0 sm:px-6 relative">
        <div
          className={`${isLoading ? "opacity-100" : ""
            } transition-all opacity-0 h-0.5 bg-slate-400 w-full overflow-hidden absolute left-0 right-0 top-0`}
        >
          <div
            className={`w-1/2 bg-primary h-full absolute left-0 rounded-lg -translate-x-[100%] ${isLoading ? "animate-slideIn" : ""
              }`}
          />
        </div>

        <Table className="mt-6">
          <TableHeader>
            <TableRow>
              <TableHead>Razão Social</TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead>Cidade / UF</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {isLoading ? (
              linhasSkeleton
            ) : total === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                  Nenhum fornecedor cadastrado. Clique em <b>+ Fornecedor</b> para cadastrar.
                </TableCell>
              </TableRow>
            ) : (
              pageItems.map((f) => (
                <TableRow key={f.id} className="hover:cursor-default">
                  <TableCell className="font-medium">
                    {f.nomerazaosocial}
                    {f.nomefantasia && (
                      <div className="text-[11px] text-muted-foreground">
                        Fantasia: {f.nomefantasia}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{f.cpfcnpj}</TableCell>
                  <TableCell className="text-sm">
                    {f.cidade || "-"}
                    {f.estado && ` / ${f.estado}`}
                  </TableCell>
                  <TableCell className="text-sm">{f.contato || "-"}</TableCell>
                  <TableCell>
                    <Badge
                      variant={f.ativo ? "default" : "outline"}
                      className={f.ativo ? "" : "border-destructive bg-destructive"}
                    >
                      {f.ativo ? "Ativo" : "Inativo"}
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
                        <DropdownMenuItem onClick={() => openEditar(f)}>Editar</DropdownMenuItem>
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
                const n = parseInt(v, 10) || DEFAULT_LIMIT;
                setLimit(n);
                setPage(1);
              }}
            >
              <SelectTrigger className="hover:cursor-pointer ml-2">
                <SelectValue placeholder={DEFAULT_LIMIT} />
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
