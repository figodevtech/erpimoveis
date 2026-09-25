// src/app/(app)/(pages)/configuracoes/tipos/components/contas-bancarias-section.tsx
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
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { ValueInput } from "@/components/ui/value-input";
import { Banco_tipo } from "../../../(financeiro)/fluxodecaixa/types";

type ContaBancaria = {
  id: number;
  titulo: string;
  tipo: string;
  agencia: string | null;
  contanumero: string | null;
  proprietario: string | null;
  valorinicial: number | null;
  ativo: boolean | null;
};

type ContaForm = {
  titulo: string;
  tipo: string;
  agencia: string;
  contanumero: string;
  proprietario: string;
  valorinicial: number;
  ativo: boolean;
};

const emptyForm: ContaForm = {
  titulo: "",
  tipo: "",
  agencia: "",
  contanumero: "",
  proprietario: "",
  valorinicial: 0,
  ativo: true,
};

const DEFAULT_LIMIT = 10;

const valorFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

export default function ContasBancariasSection() {
  const { canCreate, canEdit } = useTipoAccess("bancos");
  const [contas, setContas] = useState<ContaBancaria[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<ContaBancaria | null>(null);
  const [form, setForm] = useState<ContaForm>(emptyForm);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);

  const total = contas.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [totalPages, page]);

  const start = (page - 1) * limit;
  const end = Math.min(total, start + limit);
  const pageItems = useMemo(() => contas.slice(start, end), [contas, start, end]);

  const linhasSkeleton = useMemo(
    () =>
      Array.from({ length: Math.min(5, limit) }).map((_, i) => (
        <TableRow key={`skeleton-${i}`} className="animate-pulse">
          <TableCell className="h-10">
            <div className="h-3 w-44 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-24 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-28 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-32 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-20 bg-muted rounded" />
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

  async function loadContas() {
    try {
      setIsLoading(true);
      setErro(null);
      const res = await fetch("/api/tipos/bancos", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Erro ao carregar contas");

      const items: ContaBancaria[] = (j.items ?? j.data ?? []).map((c: any) => ({
        id: Number(c.id),
        titulo: String(c.titulo ?? ""),
        tipo: String(c.tipo ?? ""),
        agencia: (c.agencia as string | null) ?? null,
        contanumero: (c.contanumero as string | null) ?? null,
        proprietario: (c.proprietario as string | null) ?? null,
        valorinicial: c.valorinicial != null ? Number(c.valorinicial) : null,
        ativo: typeof c.ativo === "boolean" ? (c.ativo as boolean) : true,
      }));

      setContas(items);
    } catch (err: any) {
      const msg = err?.message || "Erro ao carregar contas";
      setErro(msg);
      toast.error(msg);
      setContas([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadContas();
  }, []);

  function handleChange<K extends keyof ContaForm>(key: K, value: ContaForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openNovo() {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEditar(c: ContaBancaria) {
    setEditing(c);
    setForm({
      titulo: c.titulo ?? "",
      tipo: c.tipo ?? "",
      agencia: c.agencia ?? "",
      contanumero: c.contanumero ?? "",
      proprietario: c.proprietario ?? "",
      valorinicial: c.valorinicial ?? 0,
      ativo: c.ativo ?? true,
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.titulo.trim()) {
      toast.error("Título é obrigatório.");
      return;
    }

    const payload = {
      titulo: form.titulo.trim(),
      tipo: form.tipo.trim(),
      agencia: form.agencia.trim() || null,
      contanumero: form.contanumero.trim() || null,
      proprietario: form.proprietario.trim() || null,
      valorinicial: form.valorinicial,
      ativo: form.ativo,
    };

    try {
      setIsSaving(true);

      if (editing) {
        const res = await fetch(`/api/tipos/bancos/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || "Falha ao atualizar conta");
        toast.success("Conta atualizada.");
      } else {
        const res = await fetch("/api/tipos/bancos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || "Falha ao cadastrar conta");
        toast.success("Conta cadastrada.");
      }

      setDialogOpen(false);
      setEditing(null);
      setForm(emptyForm);
      await loadContas();
    } catch (err: any) {
      toast.error(err?.message || "Erro ao salvar conta");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card className="min-h-[460px]">
      <CardHeader className="border-b pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Contas bancárias</CardTitle>
            <CardDescription className="flex items-center gap-2">
              <button
                onClick={loadContas}
                className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70 text-xs"
              >
                <span>Recarregar</span>
                <Loader2 width={12} className={isLoading ? "animate-spin" : ""} />
              </button>
              <span className="text-foreground/60">
                {total} conta{total === 1 ? "" : "s"} cadastrada{total === 1 ? "" : "s"}
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
              <Button size="sm" className="hover:cursor-pointer" onClick={openNovo} disabled={!canCreate}>
                <Plus className="mr-1 h-4 w-4" />
                Conta
              </Button>
            </DialogTrigger>

            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{editing ? "Editar conta" : "Nova conta"}</DialogTitle>
              </DialogHeader>

              <div className="mt-4 space-y-4">
                <div className="space-y-1.5">
                  <Label>Título</Label>
                  <Input value={form.titulo} onChange={(e) => handleChange("titulo", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Tipo</Label>
                  <Select value={form.tipo} onValueChange={(e)=>handleChange("tipo", e)}>
                    <SelectTrigger className="w-full">

                    <SelectValue placeholder="Selecione"></SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(Banco_tipo).map((t)=>
                        <SelectItem key={t[1]} className="hover:cursor-pointer" value={t[0]}>{t[1]}</SelectItem>
                      )}
                    </SelectContent>

                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Agência / Conta</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Input
                      value={form.agencia}
                      onChange={(e) => handleChange("agencia", e.target.value)}
                      placeholder="Agência"
                    />
                    <Input
                      value={form.contanumero}
                      onChange={(e) => handleChange("contanumero", e.target.value)}
                      placeholder="Conta"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Proprietário</Label>
                  <Input
                    value={form.proprietario}
                    onChange={(e) => handleChange("proprietario", e.target.value)}
                    placeholder="Nome do proprietário"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Valor inicial</Label>
                  <ValueInput
                    value={form.valorinicial}
                    onValueChange={(v) => handleChange("valorinicial", v)}
                    mode="decimal"
                    decimals={6}
                    allowNegative
                  />
                  <p className="text-xs text-muted-foreground">
                    Digite o valor com vírgula, até 6 casas decimais (443,32 ou 443,333221). Comece com{" "}
                    <b>-</b> para conta que abre negativa.
                  </p>
                </div>

                <div className="mt-4 flex items-center justify-between rounded-md border px-3 py-2 bg-muted/40">
                  <div className="space-y-0.5">
                    <span className="text-sm font-medium">Status da conta</span>
                    <p className="text-xs text-muted-foreground">
                      Defina se esta conta pode ser usada nos lançamentos.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground hidden sm:inline">
                      {form.ativo ? "Ativa" : "Inativa"}
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
              <TableHead>Título</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Agência / Conta</TableHead>
              <TableHead>Proprietário</TableHead>
              <TableHead>Valor inicial</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              linhasSkeleton
            ) : total === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  Nenhuma conta bancária cadastrada. Clique em <b>+ Conta</b> para cadastrar.
                </TableCell>
              </TableRow>
            ) : (
              pageItems.map((c) => (
                <TableRow key={c.id} className="hover:cursor-default">
                  <TableCell className="font-medium">{c.titulo}</TableCell>
                  <TableCell>{c.tipo}</TableCell>
                  <TableCell className="text-sm">
                    {c.agencia || "-"}
                    {c.contanumero && ` / ${c.contanumero}`}
                  </TableCell>
                  <TableCell className="text-sm">{c.proprietario || "-"}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {valorFormatter.format(Number(c.valorinicial ?? 0))}
                  </TableCell>
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
                        <DropdownMenuItem disabled={!canEdit} onClick={() => openEditar(c)}>Editar</DropdownMenuItem>
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
