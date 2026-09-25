"use client";

import { useTipoAccess } from "./use-tipo-access";

import axios, { isAxiosError } from "axios";
import { useCallback, useEffect, useState } from "react";
import { Loader2, MoreHorizontal, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/lib/toast";
import type { UsoConsumoGrupo } from "@/types/usoconsumo";

type Form = { nome: string; descricao: string; ativo: boolean };
const EMPTY: Form = { nome: "", descricao: "", ativo: true };

function errorText(error: unknown) {
  return isAxiosError(error) ? error.response?.data?.error ?? error.message : "Erro inesperado.";
}

export default function GruposUsoConsumoSection() {
  const { canCreate, canEdit } = useTipoAccess("grupos_usoconsumo");
  const [groups, setGroups] = useState<UsoConsumoGrupo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UsoConsumoGrupo | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get("/api/tipos/grupos-usoconsumo");
      setGroups(data.data ?? []);
    } catch (error) {
      toast.error("Não foi possível carregar os grupos de uso/consumo.", { description: errorText(error) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function create() {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  }

  function edit(group: UsoConsumoGrupo) {
    setEditing(group);
    setForm({ nome: group.nome, descricao: group.descricao ?? "", ativo: group.ativo });
    setOpen(true);
  }

  async function save() {
    if (!form.nome.trim()) return toast.error("Informe o nome do grupo.");
    setSaving(true);
    try {
      const payload = { nome: form.nome.trim(), descricao: form.descricao.trim() || null, ativo: form.ativo };
      if (editing) await axios.patch(`/api/tipos/grupos-usoconsumo/${editing.id}`, payload);
      else await axios.post("/api/tipos/grupos-usoconsumo", payload);
      toast.success(editing ? "Grupo de uso/consumo atualizado." : "Grupo de uso/consumo cadastrado.");
      setOpen(false);
      await load();
    } catch (error) {
      toast.error("Grupo não salvo.", { description: errorText(error) });
    } finally {
      setSaving(false);
    }
  }

  async function toggle(group: UsoConsumoGrupo) {
    try {
      await axios.patch(`/api/tipos/grupos-usoconsumo/${group.id}`, { ativo: !group.ativo });
      toast.success(group.ativo ? "Grupo inativado." : "Grupo reativado.");
      await load();
    } catch (error) {
      toast.error("Status não alterado.", { description: errorText(error) });
    }
  }

  return (
    <Card className="min-h-[420px]">
      <CardHeader className="border-b pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Grupos de uso/consumo</CardTitle>
            <CardDescription>{groups.length} grupo{groups.length === 1 ? "" : "s"} cadastrado{groups.length === 1 ? "" : "s"}</CardDescription>
          </div>
          <Button size="sm" onClick={create} disabled={!canCreate}><Plus className="mr-1 h-4 w-4" />Grupo</Button>
        </div>
      </CardHeader>
      <CardContent className="p-4 sm:p-6">
        <Table>
          <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Descrição</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
          <TableBody>
            {loading ? Array.from({ length: 4 }).map((_, index) => <TableRow key={index} className="animate-pulse"><TableCell><div className="h-4 w-40 rounded bg-muted" /></TableCell><TableCell><div className="h-4 w-56 rounded bg-muted" /></TableCell><TableCell><div className="h-5 w-16 rounded bg-muted" /></TableCell><TableCell /></TableRow>) : null}
            {!loading && groups.length === 0 ? <TableRow><TableCell colSpan={4} className="h-28 text-center text-muted-foreground">Nenhum grupo de uso/consumo cadastrado.</TableCell></TableRow> : null}
            {!loading ? groups.map((group) => (
              <TableRow key={group.id}>
                <TableCell className="font-medium">{group.nome}</TableCell>
                <TableCell className="text-muted-foreground">{group.descricao || "—"}</TableCell>
                <TableCell><Badge variant={group.ativo ? "default" : "outline"}>{group.ativo ? "Ativo" : "Inativo"}</Badge></TableCell>
                <TableCell className="text-right">
                  <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" disabled={!canEdit}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => edit(group)} disabled={!canEdit}>Editar</DropdownMenuItem><DropdownMenuItem onClick={() => void toggle(group)} disabled={!canEdit}>{group.ativo ? "Inativar" : "Reativar"}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
                </TableCell>
              </TableRow>
            )) : null}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Editar grupo de uso/consumo" : "Novo grupo de uso/consumo"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2"><Label htmlFor="grupo-usoconsumo-nome">Nome do grupo</Label><Input id="grupo-usoconsumo-nome" value={form.nome} maxLength={100} onChange={(event) => setForm((current) => ({ ...current, nome: event.target.value }))} placeholder="Ex.: EPIs, limpeza..." /></div>
            <div className="space-y-2"><Label htmlFor="grupo-usoconsumo-descricao">Descrição</Label><Input id="grupo-usoconsumo-descricao" value={form.descricao} maxLength={500} onChange={(event) => setForm((current) => ({ ...current, descricao: event.target.value }))} placeholder="Descrição opcional" /></div>
            <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3"><div><Label>Status do grupo</Label><p className="text-xs text-muted-foreground">Grupos inativos não aparecem no cadastro de itens.</p></div><Switch checked={form.ativo} onCheckedChange={(ativo) => setForm((current) => ({ ...current, ativo }))} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button><Button onClick={() => void save()} disabled={saving || !(editing ? canEdit : canCreate)}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
