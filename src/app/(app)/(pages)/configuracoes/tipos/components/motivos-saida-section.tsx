// src/app/(app)/(pages)/configuracoes/tipos/components/motivos-saida-section.tsx
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

type MotivoSaida = {
  id: number;
  codigo: string;
  nome: string;
  descricao?: string | null;
  escopo: Escopo;
  ativo?: boolean | null;
};

type MotivoSaidaForm = {
  nome: string;
  descricao: string;
  escopo: Escopo;
  ativo: boolean;
};

const emptyForm: MotivoSaidaForm = {
  nome: "",
  descricao: "",
  escopo: "AMBOS",
  ativo: true,
};

const ESCOPO_LABELS: Record<Escopo, string> = {
  PRODUTO: "Somente produto",
  USOCONSUMO: "Somente uso e consumo",
  AMBOS: "Produto e uso/consumo",
};

const DEFAULT_LIMIT = 10;

export default function MotivosSaidaSection() {
  const [motivos, setMotivos] = useState<MotivoSaida[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<MotivoSaida | null>(null);
  const [form, setForm] = useState<MotivoSaidaForm>(emptyForm);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);

  const total = motivos.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [totalPages, page]);

  const start = (page - 1) * limit;
  const end = Math.min(total, start + limit);
  const pageItems = useMemo(() => motivos.slice(start, end), [motivos, start, end]);

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
            <div className="h-3 w-16 bg-muted rounded" />
          </TableCell>
          <TableCell className="text-right">
            <div className="h-6 w-10 bg-muted rounded-full ml-auto" />
          </TableCell>
        </TableRow>
      )),
    [limit]
  );

  async function loadMotivos() {
    try {
      setIsLoading(true);
      setErro(null);

      const res = await fetch("/api/tipos/motivos-saida", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Erro ao carregar motivos de saída");

      const items: MotivoSaida[] = (j.items ?? []).map((m: any) => ({
        id: Number(m.id),
        codigo: String(m.codigo ?? ""),
        nome: String(m.nome ?? ""),
        descricao: m.descricao ?? null,
        escopo: (m.escopo as Escopo) ?? "AMBOS",
        ativo: typeof m.ativo === "boolean" ? (m.ativo as boolean) : true,
      }));

      setMotivos(items);
    } catch (e: any) {
      const msg = e?.message || "Erro ao carregar motivos de saída";
      setErro(msg);
      toast.error(msg);
      setMotivos([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadMotivos();
  }, []);

  function handleChange<K extends keyof MotivoSaidaForm>(key: K, value: MotivoSaidaForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openNovo() {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEditar(m: MotivoSaida) {
    setEditing(m);
    setForm({
      nome: m.nome ?? "",
      descricao: m.descricao ?? "",
      escopo: m.escopo ?? "AMBOS",
      ativo: m.ativo ?? true,
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
      ativo: form.ativo,
    };

    try {
      setIsSaving(true);

      if (editing) {
        const res = await fetch(`/api/tipos/motivos-saida/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || "Falha ao atualizar motivo");
        toast.success("Motivo atualizado.");
      } else {
        const res = await fetch("/api/tipos/motivos-saida", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || "Falha ao cadastrar motivo");
        toast.success("Motivo cadastrado.");
      }

      setDialogOpen(false);
      setEditing(null);
      setForm(emptyForm);
      await loadMotivos();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar motivo");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card className="min-h-[360px]">
      <CardHeader className="border-b pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Motivos de saída</CardTitle>
            <CardDescription className="flex items-center gap-2">
              <button
                onClick={loadMotivos}
                className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70 text-xs"
              >
                <span>Recarregar</span>
                <Loader2 width={12} className={isLoading ? "animate-spin" : ""} />
              </button>
              <span className="text-foreground/60">
                {total} motivo{total === 1 ? "" : "s"}
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
                Motivo
              </Button>
            </DialogTrigger>

            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{editing ? "Editar motivo" : "Novo motivo de saída"}</DialogTitle>
              </DialogHeader>

              <div className="mt-4 space-y-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Nome</label>
                  <Input
                    value={form.nome}
                    onChange={(e) => handleChange("nome", e.target.value)}
                    placeholder="Ex.: Devolução ao fornecedor"
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
                    placeholder="Detalhe quando esse motivo deve ser usado"
                    rows={2}
                    maxLength={300}
                  />
                </div>

                <div className="flex items-center justify-between rounded-md border px-3 py-2 bg-muted/40">
                  <div className="space-y-0.5">
                    <span className="text-sm font-medium">Status</span>
                    <p className="text-xs text-muted-foreground">Somente motivos ativos aparecem no dialog de saída.</p>
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
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              linhasSkeleton
            ) : total === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  Nenhum motivo cadastrado. Clique em <b>+ Motivo</b> para cadastrar.
                </TableCell>
              </TableRow>
            ) : (
              pageItems.map((m) => (
                <TableRow key={m.id} className="hover:cursor-default">
                  <TableCell className="font-medium">{m.nome || "-"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {m.codigo}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{ESCOPO_LABELS[m.escopo]}</TableCell>
                  <TableCell>
                    <Badge
                      variant={m.ativo ? "default" : "outline"}
                      className={m.ativo ? "" : "border-destructive bg-destructive"}
                    >
                      {m.ativo ? "Ativo" : "Inativo"}
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
                        <DropdownMenuItem onClick={() => openEditar(m)}>Editar</DropdownMenuItem>
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
