// src/app/(app)/(pages)/configuracoes/tipos/components/categorias-transacao-section.tsx
"use client";

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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  TRANSACTION_CATEGORY_ICON_OPTIONS,
  TransactionCategoryIcon,
  type TransactionCategoryIconName,
} from "@/lib/transaction-category-icons";

type CategoriaTransacao = {
  id: number;
  nome: string;
  descricao: string | null;
  icone: TransactionCategoryIconName;
  ativo: boolean | null;
  codigo_sistema: string | null;
};

type CategoriaForm = {
  nome: string;
  descricao: string;
  icone: TransactionCategoryIconName;
  ativo: boolean;
};

const emptyForm: CategoriaForm = {
  nome: "",
  descricao: "",
  icone: "other",
  ativo: true,
};

const DEFAULT_LIMIT = 10;

export default function CategoriasTransacaoSection() {
  const [categorias, setCategorias] = useState<CategoriaTransacao[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<CategoriaTransacao | null>(null);
  const [form, setForm] = useState<CategoriaForm>(emptyForm);
  const [iconSearch, setIconSearch] = useState("");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);

  const total = categorias.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [totalPages, page]);

  const start = (page - 1) * limit;
  const end = Math.min(total, start + limit);
  const pageItems = useMemo(() => categorias.slice(start, end), [categorias, start, end]);

  const linhasSkeleton = useMemo(
    () =>
      Array.from({ length: Math.min(5, limit) }).map((_, i) => (
        <TableRow key={`skeleton-${i}`} className="animate-pulse">
          <TableCell className="h-10">
            <div className="h-3 w-32 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-8 w-8 bg-muted rounded-full" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-48 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-5 w-16 bg-muted rounded-full mx-auto" />
          </TableCell>
          <TableCell className="text-right">
            <div className="h-6 w-10 bg-muted rounded-full ml-auto" />
          </TableCell>
        </TableRow>
      )),
    [limit]
  );

  async function loadCategorias() {
    try {
      setIsLoading(true);
      setErro(null);
      const res = await fetch("/api/tipos/categorias-transacao", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Erro ao carregar categorias");

      const items: CategoriaTransacao[] = (j.items ?? j.data ?? []).map((c: any) => ({
        id: Number(c.id),
        nome: String(c.nome ?? ""),
        descricao: (c.descricao as string | null) ?? null,
        icone: (c.icone as TransactionCategoryIconName) ?? "other",
        ativo: typeof c.ativo === "boolean" ? (c.ativo as boolean) : true,
        codigo_sistema: (c.codigo_sistema as string | null) ?? null,
      }));

      setCategorias(items);
    } catch (e: any) {
      const msg = e?.message || "Erro ao carregar categorias";
      setErro(msg);
      toast.error(msg);
      setCategorias([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadCategorias();
  }, []);

  function handleChange<K extends keyof CategoriaForm>(key: K, value: CategoriaForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openNovo() {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEditar(c: CategoriaTransacao) {
    setEditing(c);
    setForm({
      nome: c.nome ?? "",
      descricao: c.descricao ?? "",
      icone: c.icone ?? "other",
      ativo: c.ativo ?? true,
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.nome.trim()) {
      toast.error("Nome é obrigatório.");
      return;
    }

    const payload = {
      nome: form.nome.trim(),
      descricao: form.descricao.trim() || null,
      icone: form.icone,
      ativo: form.ativo,
    };

    try {
      setIsSaving(true);

      if (editing) {
        const res = await fetch(`/api/tipos/categorias-transacao/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || "Falha ao atualizar categoria");
        toast.success("Categoria atualizada.");
      } else {
        const res = await fetch("/api/tipos/categorias-transacao", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || "Falha ao cadastrar categoria");
        toast.success("Categoria cadastrada.");
      }

      setDialogOpen(false);
      setEditing(null);
      setForm(emptyForm);
      await loadCategorias();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar categoria");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card className="min-h-[460px]">
      <CardHeader className="border-b pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Categorias de transação</CardTitle>
            <CardDescription className="flex items-center gap-2">
              <button
                onClick={loadCategorias}
                className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70 text-xs"
              >
                <span>Recarregar</span>
                <Loader2 width={12} className={isLoading ? "animate-spin" : ""} />
              </button>
              <span className="text-foreground/60">
                {total} categoria{total === 1 ? "" : "s"}
              </span>
              {erro && (
                <Badge variant="destructive" className="ml-1">
                  {erro}
                </Badge>
              )}
            </CardDescription>
          </div>

          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) {
                setEditing(null);
                setForm(emptyForm);
                setIconSearch("");
                setIconPickerOpen(false);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" className="hover:cursor-pointer" onClick={openNovo}>
                <Plus className="mr-1 h-4 w-4" />
                Categoria
              </Button>
            </DialogTrigger>

            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{editing ? "Editar categoria" : "Nova categoria"}</DialogTitle>
              </DialogHeader>

              <div className="mt-4 space-y-4 bg-card rounded-2xl p-4">
                <div className="space-y-1.5">
                  <Label>Nome</Label>
                  <Input value={form.nome} onChange={(e) => handleChange("nome", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Descrição</Label>
                  <Input
                    value={form.descricao}
                    onChange={(e) => handleChange("descricao", e.target.value)}
                    placeholder="Descrição amigável"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Ícone</Label>
                  <Popover open={iconPickerOpen} onOpenChange={setIconPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline" className="w-full justify-start">
                        <TransactionCategoryIcon name={form.icone} className="h-4 w-4" />
                        {TRANSACTION_CATEGORY_ICON_OPTIONS.find((option) => option.value === form.icone)?.label ?? "Outros"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[340px] p-3" align="start">
                      <div className="relative mb-3">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={iconSearch}
                          onChange={(event) => setIconSearch(event.target.value)}
                          placeholder="Buscar ícone..."
                          className="pl-9"
                        />
                      </div>
                      <ScrollArea
                        className="h-64 overscroll-contain"
                        onWheelCapture={(event) => event.stopPropagation()}
                      >
                        <div className="grid grid-cols-4 gap-2 pr-3">
                          {TRANSACTION_CATEGORY_ICON_OPTIONS
                            .filter((option) => option.label.toLocaleLowerCase("pt-BR").includes(iconSearch.toLocaleLowerCase("pt-BR")))
                            .map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              title={option.label}
                              onClick={() => {
                                handleChange("icone", option.value);
                                setIconPickerOpen(false);
                                setIconSearch("");
                              }}
                              className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-md border p-2 text-[10px] transition-colors hover:bg-muted ${
                                form.icone === option.value ? "border-primary bg-primary/10 text-primary" : ""
                              }`}
                            >
                              <TransactionCategoryIcon name={option.value} className="h-5 w-5" />
                              <span className="line-clamp-2 text-center">{option.label}</span>
                            </button>
                            ))}
                        </div>
                      </ScrollArea>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="mt-4 flex items-center justify-between rounded-md border px-3 py-2 bg-muted/40">
                  <div className="space-y-0.5">
                    <span className="text-sm font-medium">Status da categoria</span>
                    <p className="text-xs text-muted-foreground">Habilita esta categoria para uso.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground hidden sm:inline">
                      {form.ativo ? "Ativa" : "Inativa"}
                    </span>
                    <Switch
                      checked={form.ativo}
                      disabled={Boolean(editing?.codigo_sistema)}
                      onCheckedChange={(val) => handleChange("ativo", val)}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => {
                    setDialogOpen(false);
                    setEditing(null);
                    setForm(emptyForm);
                  }}
                >
                  Cancelar
                </Button>
                <Button type="button" onClick={handleSave} disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar
                </Button>
              </div>
            </DialogContent>
          </Dialog>
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

        <Table className="mt-6">
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Ícone</TableHead>
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
                <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                  Nenhuma categoria cadastrada. Clique em <b>+ Categoria</b> para cadastrar.
                </TableCell>
              </TableRow>
            ) : (
              pageItems.map((c) => (
                <TableRow key={c.id} className="hover:cursor-default">
                  <TableCell className="font-mono">{c.nome}</TableCell>
                  <TableCell>
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15">
                      <TransactionCategoryIcon name={c.icone} className="h-4 w-4" />
                    </div>
                  </TableCell>
                  <TableCell>{c.descricao || "—"}</TableCell>
                  <TableCell>
                    <Badge
                      variant={c.ativo ? "default" : "outline"}
                      className={c.ativo ? "" : "border-destructive bg-destructive"}
                    >
                      {c.ativo ? "Ativa" : "Inativa"}
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
                        <DropdownMenuItem onClick={() => openEditar(c)}>Editar</DropdownMenuItem>
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
