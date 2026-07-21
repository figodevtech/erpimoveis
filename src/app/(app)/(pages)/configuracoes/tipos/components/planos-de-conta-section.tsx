// src/app/(app)/(pages)/configuracoes/tipos/components/planos-de-conta-section.tsx
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
  FileSpreadsheet,
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

type PlanoDeConta = {
  id: number;
  codigo: string | null;
  nome: string;
  descricao: string | null;
  ativo: boolean | null;
};

type PlanoForm = {
  codigo: string;
  nome: string;
  descricao: string;
  ativo: boolean;
};

const emptyForm: PlanoForm = {
  codigo: "",
  nome: "",
  descricao: "",
  ativo: true,
};

const DEFAULT_LIMIT = 10;

export default function PlanosDeContaSection() {
  const [items, setItems] = useState<PlanoDeConta[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todos" | "ativos" | "inativos">("todos");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PlanoDeConta | null>(null);
  const [form, setForm] = useState<PlanoForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const [page, setPage] = useState(1);
  const limit = DEFAULT_LIMIT;

  async function loadPlanos() {
    try {
      setLoading(true);
      const res = await fetch("/api/tipos/planos-de-conta", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Erro ao carregar planos de conta");
      setItems(json.items ?? []);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao carregar planos de conta");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPlanos();
  }, []);

  function handleOpenCreate() {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function handleOpenEdit(item: PlanoDeConta) {
    setEditing(item);
    setForm({
      codigo: item.codigo ?? "",
      nome: item.nome ?? "",
      descricao: item.descricao ?? "",
      ativo: Boolean(item.ativo ?? true),
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.nome.trim()) {
      toast.warning("Nome do plano de conta é obrigatório.");
      return;
    }

    try {
      setSaving(true);
      if (editing) {
        const res = await fetch(`/api/tipos/planos-de-conta/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? "Erro ao atualizar");
        toast.success("Plano de conta atualizado com sucesso!");
      } else {
        const res = await fetch("/api/tipos/planos-de-conta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? "Erro ao criar");
        toast.success("Plano de conta cadastrado com sucesso!");
      }
      setDialogOpen(false);
      loadPlanos();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar plano de conta");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(item: PlanoDeConta) {
    const nextAtivo = !(item.ativo ?? true);
    try {
      const res = await fetch(`/api/tipos/planos-de-conta/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: nextAtivo }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Erro ao alterar status");
      toast.success(nextAtivo ? "Plano de conta ativado!" : "Plano de conta desativado!");
      loadPlanos();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao alterar status");
    }
  }

  const filtered = useMemo(() => {
    return items.filter((item) => {
      const isAtivo = item.ativo ?? true;
      if (statusFilter === "ativos" && !isAtivo) return false;
      if (statusFilter === "inativos" && isAtivo) return false;

      if (!search.trim()) return true;
      const term = search.toLowerCase();
      const codigoMatch = item.codigo?.toLowerCase().includes(term) ?? false;
      const nomeMatch = item.nome.toLowerCase().includes(term);
      const descMatch = item.descricao?.toLowerCase().includes(term) ?? false;
      return codigoMatch || nomeMatch || descMatch;
    });
  }, [items, search, statusFilter]);

  const totalPages = Math.ceil(filtered.length / limit) || 1;
  const currentPage = Math.min(page, totalPages);
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * limit;
    return filtered.slice(start, start + limit);
  }, [filtered, currentPage, limit]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-xl font-bold flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              Planos de Conta
            </CardTitle>
            <CardDescription>
              Gerencie os planos de conta para organizar as movimentações financeiras.
            </CardDescription>
          </div>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={handleOpenCreate} className="hover:cursor-pointer">
                <Plus className="mr-2 h-4 w-4" /> Novo Plano de Conta
              </Button>
            </DialogTrigger>

            <DialogContent className="sm:max-w-[450px]">
              <DialogHeader>
                <DialogTitle>
                  {editing ? "Editar Plano de Conta" : "Novo Plano de Conta"}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 py-2 bg-card p-4 rounded-2xl">
                <div className="space-y-1.5">
                  <Label htmlFor="codigo">Código</Label>
                  <Input
                    id="codigo"
                    placeholder="Ex: 1.1, 1.01.01"
                    value={form.codigo}
                    onChange={(e) => setForm((prev) => ({ ...prev, codigo: e.target.value }))}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="nome">
                    Nome <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="nome"
                    placeholder="Ex: RECEITAS OPERACIONAIS, CUSTOS DE PRODUÇÃO"
                    value={form.nome}
                    onChange={(e) => setForm((prev) => ({ ...prev, nome: e.target.value }))}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="descricao">Descrição</Label>
                  <Input
                    id="descricao"
                    placeholder="Descrição detalhada do plano de conta (opcional)"
                    value={form.descricao}
                    onChange={(e) => setForm((prev) => ({ ...prev, descricao: e.target.value }))}
                  />
                </div>

                <div className="flex items-center justify-between pt-2">
                  <Label htmlFor="ativo">Ativo</Label>
                  <Switch
                    id="ativo"
                    checked={form.ativo}
                    onCheckedChange={(checked) => setForm((prev) => ({ ...prev, ativo: checked }))}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  disabled={saving}
                >
                  Cancelar
                </Button>
                <Button type="button" onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando...
                    </>
                  ) : (
                    "Salvar"
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Filtros */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar plano de conta..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-8"
            />
          </div>

          <Select
            value={statusFilter}
            onValueChange={(val: any) => {
              setStatusFilter(val);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full sm:w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="ativos">Ativos</SelectItem>
              <SelectItem value="inativos">Inativos</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Tabela */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">Código</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead className="w-[70px] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
                    </div>
                  </TableCell>
                </TableRow>
              ) : paginated.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                    Nenhum plano de conta encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((item) => {
                  const isAtivo = item.ativo ?? true;
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-sm">{item.codigo || "-"}</TableCell>
                      <TableCell className="font-medium">{item.nome}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {item.descricao || "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={isAtivo ? "default" : "secondary"}>
                          {isAtivo ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleOpenEdit(item)}>
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleToggleStatus(item)}>
                              {isAtivo ? "Desativar" : "Ativar"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Paginação */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Página {currentPage} de {totalPages} ({filtered.length} itens)
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setPage(1)}
                disabled={currentPage === 1}
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                <ChevronRightIcon className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setPage(totalPages)}
                disabled={currentPage === totalPages}
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
