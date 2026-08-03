// src/app/(app)/(pages)/configuracoes/tipos/components/tipos-entrada-section.tsx
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

type Escopo = "PRODUTO" | "USOCONSUMO" | "AMBOS";

type TipoEntrada = {
  id: number;
  codigo: string;
  nome: string;
  descricao?: string | null;
  escopo: Escopo;
  exigeValor: boolean;
  ativo?: boolean | null;
};

type TipoEntradaForm = {
  nome: string;
  descricao: string;
  escopo: Escopo;
  exigeValor: boolean;
  ativo: boolean;
};

const emptyForm: TipoEntradaForm = {
  nome: "",
  descricao: "",
  escopo: "AMBOS",
  exigeValor: true,
  ativo: true,
};

const ESCOPO_LABELS: Record<Escopo, string> = {
  PRODUTO: "Somente produto",
  USOCONSUMO: "Somente uso e consumo",
  AMBOS: "Produto e uso/consumo",
};

const DEFAULT_LIMIT = 10;

export default function TiposEntradaSection() {
  const [tipos, setTipos] = useState<TipoEntrada[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<TipoEntrada | null>(null);
  const [form, setForm] = useState<TipoEntradaForm>(emptyForm);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);

  const total = tipos.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [totalPages, page]);

  const start = (page - 1) * limit;
  const end = Math.min(total, start + limit);
  const pageItems = useMemo(() => tipos.slice(start, end), [tipos, start, end]);

  const linhasSkeleton = useMemo(
    () =>
      Array.from({ length: Math.min(5, limit) }).map((_, i) => (
        <TableRow key={`skeleton-${i}`} className="animate-pulse">
          <TableCell className="h-10">
            <div className="h-3 w-48 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-24 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-20 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-20 bg-muted rounded" />
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

  async function loadTipos() {
    try {
      setIsLoading(true);
      setErro(null);

      const res = await fetch("/api/tipos/tipos-entrada", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Erro ao carregar tipos de entrada");

      const items: TipoEntrada[] = (j.items ?? []).map((t: any) => ({
        id: Number(t.id),
        codigo: String(t.codigo ?? ""),
        nome: String(t.nome ?? ""),
        descricao: t.descricao ?? null,
        escopo: (t.escopo as Escopo) ?? "AMBOS",
        exigeValor: typeof t.exigeValor === "boolean" ? t.exigeValor : true,
        ativo: typeof t.ativo === "boolean" ? (t.ativo as boolean) : true,
      }));

      setTipos(items);
    } catch (e: any) {
      const msg = e?.message || "Erro ao carregar tipos de entrada";
      setErro(msg);
      toast.error(msg);
      setTipos([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadTipos();
  }, []);

  function handleChange<K extends keyof TipoEntradaForm>(key: K, value: TipoEntradaForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openNovo() {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEditar(t: TipoEntrada) {
    setEditing(t);
    setForm({
      nome: t.nome ?? "",
      descricao: t.descricao ?? "",
      escopo: t.escopo ?? "AMBOS",
      exigeValor: t.exigeValor ?? true,
      ativo: t.ativo ?? true,
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.nome.trim()) {
      toast.error("Nome obrigatório.");
      return;
    }

    const payload = {
      nome: form.nome.trim(),
      descricao: form.descricao.trim() || null,
      escopo: form.escopo,
      exigeValor: form.exigeValor,
      ativo: form.ativo,
    };

    try {
      setIsSaving(true);

      if (editing) {
        const res = await fetch(`/api/tipos/tipos-entrada/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || "Falha ao atualizar tipo");
        toast.success("Tipo atualizado.");
      } else {
        const res = await fetch("/api/tipos/tipos-entrada", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || "Falha ao cadastrar tipo");
        toast.success("Tipo cadastrado.");
      }

      setDialogOpen(false);
      setEditing(null);
      setForm(emptyForm);
      await loadTipos();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar tipo");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card className="min-h-[360px]">
      <CardHeader className="border-b pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Motivos de entradas</CardTitle>
            <CardDescription className="flex items-center gap-2">
              <button
                onClick={loadTipos}
                className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70 text-xs"
              >
                <span>Recarregar</span>
                <Loader2 width={12} className={isLoading ? "animate-spin" : ""} />
              </button>
              <span className="text-foreground/60">
                {total} tipo{total === 1 ? "" : "s"}
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
              <Button size="sm" className="hover:cursor-pointer" onClick={openNovo}>
                <Plus className="mr-1 h-4 w-4" />
                Tipo
              </Button>
            </DialogTrigger>

            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{editing ? "Editar tipo" : "Novo tipo de entrada"}</DialogTitle>
              </DialogHeader>

              <div className="mt-4 space-y-4 p-4 bg-card rounded-xl">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Nome</label>
                  <Input
                    value={form.nome}
                    onChange={(e) => handleChange("nome", e.target.value)}
                    placeholder="Ex.: Retorno de garantia"
                  />
                  {editing ? (
                    <p className="text-xs text-muted-foreground">
                      Código: <span className="font-mono">{editing.codigo}</span> (não muda ao editar o nome)
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium">Aparece em</label>
                  <Select value={form.escopo} onValueChange={(v) => handleChange("escopo", v as Escopo)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PRODUTO">Somente produto (estoque)</SelectItem>
                      <SelectItem value="USOCONSUMO">Somente uso e consumo</SelectItem>
                      <SelectItem value="AMBOS">Produto e uso/consumo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium">Descrição (opcional)</label>
                  <Textarea
                    value={form.descricao}
                    onChange={(e) => handleChange("descricao", e.target.value)}
                    placeholder="Detalhe quando esse tipo deve ser usado"
                    rows={2}
                    maxLength={300}
                  />
                </div>

                <div className="flex items-center justify-between rounded-md border px-3 py-2 bg-muted/40">
                  <div className="space-y-0.5">
                    <span className="text-sm font-medium">Obriga informar valor</span>
                    <p className="text-xs text-muted-foreground">
                      Ligado: a entrada exige valor unitário maior que zero. Desligado: aceita valor zero.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground hidden sm:inline">
                      {form.exigeValor ? "Obrigatório" : "Opcional"}
                    </span>
                    <Switch checked={form.exigeValor} onCheckedChange={(val) => handleChange("exigeValor", val)} />
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-md border px-3 py-2 bg-muted/40">
                  <div className="space-y-0.5">
                    <span className="text-sm font-medium">Status</span>
                    <p className="text-xs text-muted-foreground">Somente tipos ativos aparecem no dialog de entrada.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground hidden sm:inline">
                      {form.ativo ? "Ativo" : "Inativo"}
                    </span>
                    <Switch checked={form.ativo} onCheckedChange={(val) => handleChange("ativo", val)} />
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
              <TableHead>Código</TableHead>
              <TableHead>Aparece em</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              linhasSkeleton
            ) : total === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  Nenhum tipo cadastrado. Clique em <b>+ Tipo</b> para cadastrar.
                </TableCell>
              </TableRow>
            ) : (
              pageItems.map((t) => (
                <TableRow key={t.id} className="hover:cursor-default">
                  <TableCell className="font-medium">{t.nome || "-"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {t.codigo}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{ESCOPO_LABELS[t.escopo]}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {t.exigeValor ? "Obrigatório" : "Opcional"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={t.ativo ? "default" : "outline"}
                      className={t.ativo ? "" : "border-destructive bg-destructive"}
                    >
                      {t.ativo ? "Ativo" : "Inativo"}
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
                        <DropdownMenuItem onClick={() => openEditar(t)}>Editar</DropdownMenuItem>
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
