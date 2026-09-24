// src/app/(app)/(pages)/configuracoes/tipos/components/fornecedores-section.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import {
  ChevronsLeft,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  ChevronsRight,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import FornecedorDialog from "./fornecedorDialog";
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

type Fornecedor = {
  id: number;
  cpfcnpj: string;
  inscricaoestadual?: string | null;
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

const DEFAULT_LIMIT = 50;

export default function FornecedoresSection() {
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const requestId = useRef(0);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Fornecedor | null>(null);
  const [fornecedorExcluir, setFornecedorExcluir] = useState<Fornecedor | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const start = (page - 1) * limit;
  const end = Math.min(total, start + limit);

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

  const loadFornecedores = useCallback(async () => {
    const currentRequest = ++requestId.current;
    try {
      setIsLoading(true);
      setErro(null);
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.set("search", search);
      const res = await fetch(`/api/tipos/fornecedores?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Erro ao carregar fornecedores");

      if (currentRequest !== requestId.current) return;

      const nextTotal = Number(json.pagination?.total ?? 0);
      const lastPage = Math.max(1, Math.ceil(nextTotal / limit));
      if (page > lastPage) {
        setPage(lastPage);
        return;
      }

      const items: Fornecedor[] = (json.items ?? json.data ?? []).map((f: any) => ({
        id: Number(f.id),
        cpfcnpj: String(f.cpfcnpj ?? ""),
        inscricaoestadual: (f.inscricaoestadual as string | null) ?? null,
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
      setTotal(nextTotal);
    } catch (err: any) {
      if (currentRequest !== requestId.current) return;
      const msg = err?.message || "Erro ao carregar fornecedores";
      setErro(msg);
      toast.error(msg);
      setFornecedores([]);
      setTotal(0);
    } finally {
      if (currentRequest === requestId.current) setIsLoading(false);
    }
  }, [page, limit, search]);

  useEffect(() => {
    void loadFornecedores();
    return () => { requestId.current += 1; };
  }, [loadFornecedores]);

  function openEditar(f: Fornecedor) {
    setEditing(f);
    setDialogOpen(true);
  }

  async function excluirFornecedor() {
    if (!fornecedorExcluir) return;

    try {
      setIsDeleting(true);
      const res = await fetch(`/api/tipos/fornecedores/${fornecedorExcluir.id}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        const vinculos = json?.vinculos;
        const detalhes = vinculos
          ? [
              vinculos.produtos ? `${vinculos.produtos} produto(s)` : null,
              vinculos.entradas ? `${vinculos.entradas} entrada(s)` : null,
              vinculos.notasFiscais ? `${vinculos.notasFiscais} nota(s) fiscal(is)` : null,
            ].filter(Boolean).join(", ")
          : "";
        throw new Error(
          detalhes
            ? `${json?.error ?? "Fornecedor vinculado."} Vínculos encontrados: ${detalhes}.`
            : json?.error ?? "Erro ao excluir fornecedor",
        );
      }

      toast.success("Fornecedor excluído.");
      setFornecedorExcluir(null);
      await loadFornecedores();
    } catch (err: any) {
      toast.error("Não foi possível excluir o fornecedor", {
        description: err?.message ?? "Erro ao excluir fornecedor.",
      });
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Card className="min-h-[460px]">
      <CardHeader className="border-b pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Fornecedores</CardTitle>
            <CardDescription className="flex items-center gap-2">
              <button
                onClick={() => void loadFornecedores()}
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
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="text"
            aria-label="Pesquisar fornecedores"
            placeholder="Buscar em qualquer campo do fornecedor"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            className="pl-9 pr-9"
          />
          {searchInput && (
            <button
              type="button"
              aria-label="Limpar pesquisa"
              onClick={() => { setSearchInput(""); setSearch(""); setPage(1); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </CardHeader>

      <CardContent className="min-h-[190px] px-4 pb-4 pt-0 sm:px-6 relative">
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
                  {search
                    ? "Nenhum fornecedor encontrado para esta pesquisa."
                    : <>Nenhum fornecedor cadastrado. Clique em <b>+ Fornecedor</b> para cadastrar.</>}
                </TableCell>
              </TableRow>
            ) : (
              fornecedores.map((f) => (
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
                      <DropdownMenuContent align="end" className="w-36">
                        <DropdownMenuItem onClick={() => openEditar(f)}>Editar</DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setFornecedorExcluir(f)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
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
                const n = parseInt(v, 10) || DEFAULT_LIMIT;
                setLimit(n);
                setPage(1);
              }}
            >
              <SelectTrigger className="hover:cursor-pointer ml-2">
                <SelectValue placeholder={DEFAULT_LIMIT} />
              </SelectTrigger>
              <SelectContent>
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
      <AlertDialog
        open={Boolean(fornecedorExcluir)}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setFornecedorExcluir(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir fornecedor?</AlertDialogTitle>
            <AlertDialogDescription>
              O fornecedor <strong>{fornecedorExcluir?.nomerazaosocial}</strong> será excluído permanentemente.
              A operação será bloqueada se existirem produtos, entradas de estoque ou notas fiscais vinculadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault();
                void excluirFornecedor();
              }}
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
