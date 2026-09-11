// src/app/(app)/(pages)/configuracoes/tipos/components/grupos-produto-section.tsx
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type GrupoProduto = {
  id: number;
  nome: string;
  descricao: string | null;
  ativo: boolean | null;
  exibirPdv: boolean;
};

type GrupoForm = {
  nome: string;
  descricao: string;
  ativo: boolean;
  exibirPdv: boolean;
};

const emptyForm: GrupoForm = {
  nome: "",
  descricao: "",
  ativo: true,
  exibirPdv: true,
};

const DEFAULT_LIMIT = 10;

export default function GruposProdutoSection() {
  const [grupos, setGrupos] = useState<GrupoProduto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<GrupoProduto | null>(null);
  const [form, setForm] = useState<GrupoForm>(emptyForm);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);

  const total = grupos.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [totalPages, page]);

  const start = (page - 1) * limit;
  const end = Math.min(total, start + limit);
  const pageItems = useMemo(() => grupos.slice(start, end), [grupos, start, end]);

  const linhasSkeleton = useMemo(
    () =>
      Array.from({ length: Math.min(5, limit) }).map((_, i) => (
        <TableRow key={`skeleton-${i}`} className="animate-pulse">
          <TableCell className="h-10">
            <div className="h-3 w-48 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-64 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-5 w-16 bg-muted rounded-full mx-auto" />
          </TableCell>
          <TableCell className="text-right">
            <div className="h-5 w-16 bg-muted rounded-full" />
          </TableCell>
          <TableCell className="text-right">
            <div className="h-6 w-10 bg-muted rounded-full ml-auto" />
          </TableCell>
        </TableRow>
      )),
    [limit]
  );

  async function loadGrupos() {
    try {
      setIsLoading(true);
      setErro(null);

      const res = await fetch("/api/tipos/grupos-produto", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Falha ao carregar grupos de produto");

      const items: GrupoProduto[] = (j.items ?? j.data ?? []).map((g: any) => ({
        id: Number(g.id),
        nome: String(g.nome ?? ""),
        descricao: (g.descricao as string | null) ?? null,
        ativo: typeof g.ativo === "boolean" ? (g.ativo as boolean) : true,
        exibirPdv: g.exibirPdv ?? true,
      }));
      setGrupos(items);
    } catch (e: any) {
      const msg = e?.message || "Erro ao carregar grupos de produto";
      setErro(msg);
      toast.error(msg);
      setGrupos([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadGrupos();
  }, []);

  function handleChange<K extends keyof GrupoForm>(key: K, value: GrupoForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openNovo() {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEditar(g: GrupoProduto) {
    setEditing(g);
    setForm({
      nome: g.nome ?? "",
      descricao: g.descricao ?? "",
      ativo: g.ativo ?? true,
      exibirPdv: g.exibirPdv,
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.nome.trim()) {
      toast.error("Informe o nome do grupo.");
      return;
    }

    const payload = {
      nome: form.nome.trim(),
      descricao: form.descricao.trim() || null,
      ativo: form.ativo,
      exibirPdv: form.exibirPdv,
    };

    try {
      setIsSaving(true);

      if (editing) {
        const res = await fetch(`/api/tipos/grupos-produto/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || "Falha ao atualizar grupo de produto");
        toast.success("Grupo de produto atualizado.");
      } else {
        const res = await fetch("/api/tipos/grupos-produto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || "Falha ao cadastrar grupo de produto");
        toast.success("Grupo de produto cadastrado.");
      }

      setDialogOpen(false);
      setEditing(null);
      setForm(emptyForm);
      await loadGrupos();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar grupo de produto");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card className="min-h-[420px]">
      <CardHeader className="border-b pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Grupos de produtos</CardTitle>
            <CardDescription className="flex items-center gap-2">
              <button
                onClick={loadGrupos}
                className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70 text-xs"
              >
                <span>Recarregar</span>
                <Loader2 width={12} className={isLoading ? "animate-spin" : ""} />
              </button>
              <span className="text-foreground/60">
                {total} grupo{total === 1 ? "" : "s"} de produto
              </span>
              {erro && (
                <Badge variant="destructive" className="ml-1">
                  {erro}
                </Badge>
              )}
            </CardDescription>
          </div>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={openNovo} className="hover:cursor-pointer">
                <Plus className="mr-1 h-4 w-4" />
                Grupo
              </Button>
            </DialogTrigger>

            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{editing ? "Editar grupo de produto" : "Novo grupo de produto"}</DialogTitle>
              </DialogHeader>

              <div className="mt-4 space-y-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Nome do grupo</label>
                  <Input value={form.nome} onChange={(e) => handleChange("nome", e.target.value)} placeholder="Ex.: MOTOR, FREIOS..." />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium">Descricao</label>
                  <Input
                    value={form.descricao}
                    onChange={(e) => handleChange("descricao", e.target.value)}
                    placeholder="Descricao amigavel para relatorios (opcional)"
                  />
                </div>

                <div className="flex items-center justify-between rounded-md border px-3 py-2 bg-muted/40">
                  <div className="space-y-0.5">
                    <span className="text-sm font-medium">Status do grupo</span>
                    <p className="text-xs text-muted-foreground">
                      Defina se este grupo pode ser usado nos produtos.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground hidden sm:inline">
                      {form.ativo ? "Ativo" : "Inativo"}
                    </span>
                    <Switch checked={form.ativo} onCheckedChange={(val) => handleChange("ativo", val)} />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 bg-muted/40">
                  <div className="space-y-0.5">
                    <label htmlFor="grupo-exibir-pdv" className="text-sm font-medium">Exibir no PDV</label>
                    <p id="grupo-exibir-pdv-descricao" className="text-xs text-muted-foreground">
                      Ao desativar, todos os produtos deste grupo ficam ocultos no PDV,
                      mesmo que estejam habilitados individualmente.
                    </p>
                  </div>
                  <Switch
                    id="grupo-exibir-pdv"
                    aria-describedby="grupo-exibir-pdv-descricao"
                    checked={form.exibirPdv}
                    onCheckedChange={(val) => handleChange("exibirPdv", val)}
                  />
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

      <CardContent className="min-h-[220px] -mt-[24px] px-4 pb-4 pt-0 sm:px-6 relative">
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
              <TableHead>Descricao</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Exibir no PDV</TableHead>
              <TableHead className="text-right">Acoes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              linhasSkeleton
            ) : total === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  Nenhum grupo cadastrado. Clique em <b>+ Grupo</b> para cadastrar.
                </TableCell>
              </TableRow>
            ) : (
              pageItems.map((g) => (
                <TableRow key={g.id} className="hover:cursor-default">
                  <TableCell className="font-medium">{g.nome || "-"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{g.descricao || "-"}</TableCell>
                  <TableCell>
                    <Badge
                      variant={g.ativo ? "default" : "outline"}
                      className={g.ativo ? "" : "border-destructive bg-destructive"}
                    >
                      {g.ativo ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={g.exibirPdv ? "default" : "outline"}>
                      {g.exibirPdv ? "Sim" : "Não"}
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
                        <DropdownMenuItem onClick={() => openEditar(g)}>Editar</DropdownMenuItem>
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
