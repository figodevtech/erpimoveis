"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderTree,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";

type PlanoContaGrupo = {
  id: number;
  codigo: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
};

type PlanoConta = {
  id: number;
  codigo: string | null;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  grupo_id: number;
};

type GroupForm = {
  codigo: string;
  nome: string;
  descricao: string;
  ativo: boolean;
};

type PlanForm = GroupForm & {
  grupo_id: string;
};

const emptyGroupForm: GroupForm = { codigo: "", nome: "", descricao: "", ativo: true };
const emptyPlanForm: PlanForm = { ...emptyGroupForm, grupo_id: "" };

function compareCodes(first?: string | null, second?: string | null) {
  return String(first ?? "").localeCompare(String(second ?? ""), "pt-BR", {
    numeric: true,
    sensitivity: "base",
  });
}

export default function PlanosDeContaSection() {
  const [groups, setGroups] = useState<PlanoContaGrupo[]>([]);
  const [plans, setPlans] = useState<PlanoConta[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<PlanoContaGrupo | null>(null);
  const [groupForm, setGroupForm] = useState<GroupForm>(emptyGroupForm);

  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PlanoConta | null>(null);
  const [planForm, setPlanForm] = useState<PlanForm>(emptyPlanForm);

  async function loadData() {
    try {
      setLoading(true);
      const [groupsResponse, plansResponse] = await Promise.all([
        fetch("/api/tipos/grupos-planos-de-conta", { cache: "no-store" }),
        fetch("/api/tipos/planos-de-conta", { cache: "no-store" }),
      ]);
      const [groupsJson, plansJson] = await Promise.all([groupsResponse.json(), plansResponse.json()]);
      if (!groupsResponse.ok) throw new Error(groupsJson?.error || "Erro ao carregar grupos.");
      if (!plansResponse.ok) throw new Error(plansJson?.error || "Erro ao carregar planos de conta.");

      const nextGroups = (groupsJson.items ?? [])
        .map((group: any) => ({
          id: Number(group.id),
          codigo: String(group.codigo ?? ""),
          nome: String(group.nome ?? ""),
          descricao: group.descricao ?? null,
          ativo: typeof group.ativo === "boolean" ? group.ativo : true,
        }))
        .sort((first: PlanoContaGrupo, second: PlanoContaGrupo) => compareCodes(first.codigo, second.codigo));
      const nextPlans = (plansJson.items ?? [])
        .map((plan: any) => ({
          id: Number(plan.id),
          codigo: plan.codigo ?? null,
          nome: String(plan.nome ?? ""),
          descricao: plan.descricao ?? null,
          ativo: typeof plan.ativo === "boolean" ? plan.ativo : true,
          grupo_id: Number(plan.grupo_id),
        }))
        .sort((first: PlanoConta, second: PlanoConta) => compareCodes(first.codigo, second.codigo));

      setGroups(nextGroups);
      setPlans(nextPlans);
    } catch (error: any) {
      toast.error(error?.message || "Erro ao carregar planos de conta.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const visibleGroups = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    if (!term) return groups;
    return groups.filter((group) => {
      const groupMatches = `${group.codigo} ${group.nome} ${group.descricao ?? ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(term);
      return groupMatches || plans.some((plan) =>
        plan.grupo_id === group.id && `${plan.codigo ?? ""} ${plan.nome} ${plan.descricao ?? ""}`
          .toLocaleLowerCase("pt-BR")
          .includes(term),
      );
    });
  }, [groups, plans, search]);

  function plansForGroup(groupId: number) {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return plans.filter((plan) => {
      if (plan.grupo_id !== groupId) return false;
      if (!term) return true;
      const group = groups.find((item) => item.id === groupId);
      const groupMatches = `${group?.codigo ?? ""} ${group?.nome ?? ""} ${group?.descricao ?? ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(term);
      return groupMatches || `${plan.codigo ?? ""} ${plan.nome} ${plan.descricao ?? ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(term);
    });
  }

  function suggestGroupCode() {
    const numericCodes = groups.map((group) => Number(group.codigo)).filter(Number.isFinite);
    return String((numericCodes.length ? Math.max(...numericCodes) : 0) + 1);
  }

  function suggestPlanCode(group: PlanoContaGrupo) {
    const suffixes = plans
      .filter((plan) => plan.grupo_id === group.id && String(plan.codigo ?? "").startsWith(`${group.codigo}.`))
      .map((plan) => Number(String(plan.codigo).slice(group.codigo.length + 1)))
      .filter(Number.isFinite);
    return `${group.codigo}.${(suffixes.length ? Math.max(...suffixes) : 0) + 1}`;
  }

  function openNewGroup() {
    setEditingGroup(null);
    setGroupForm({ ...emptyGroupForm, codigo: suggestGroupCode() });
    setGroupDialogOpen(true);
  }

  function openEditGroup(group: PlanoContaGrupo) {
    setEditingGroup(group);
    setGroupForm({
      codigo: group.codigo,
      nome: group.nome,
      descricao: group.descricao ?? "",
      ativo: group.ativo,
    });
    setGroupDialogOpen(true);
  }

  function openNewPlan(group: PlanoContaGrupo) {
    setEditingPlan(null);
    setPlanForm({ ...emptyPlanForm, grupo_id: String(group.id), codigo: suggestPlanCode(group) });
    setPlanDialogOpen(true);
    setExpandedGroups((current) => new Set(current).add(group.id));
  }

  function openEditPlan(plan: PlanoConta) {
    setEditingPlan(plan);
    setPlanForm({
      grupo_id: String(plan.grupo_id),
      codigo: plan.codigo ?? "",
      nome: plan.nome,
      descricao: plan.descricao ?? "",
      ativo: plan.ativo,
    });
    setPlanDialogOpen(true);
  }

  async function saveGroup() {
    if (!groupForm.codigo.trim() || !groupForm.nome.trim()) {
      toast.error("Informe o código e o nome do grupo.");
      return;
    }
    try {
      setSaving(true);
      const response = await fetch(
        editingGroup
          ? `/api/tipos/grupos-planos-de-conta/${editingGroup.id}`
          : "/api/tipos/grupos-planos-de-conta",
        {
          method: editingGroup ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(groupForm),
        },
      );
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.error || "Erro ao salvar grupo.");
      toast.success(editingGroup ? "Grupo atualizado." : "Grupo criado.");
      setGroupDialogOpen(false);
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || "Erro ao salvar grupo.");
    } finally {
      setSaving(false);
    }
  }

  async function savePlan() {
    if (!planForm.grupo_id || !planForm.codigo.trim() || !planForm.nome.trim()) {
      toast.error("Informe o grupo, o código e o nome do plano de conta.");
      return;
    }
    try {
      setSaving(true);
      const response = await fetch(
        editingPlan ? `/api/tipos/planos-de-conta/${editingPlan.id}` : "/api/tipos/planos-de-conta",
        {
          method: editingPlan ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...planForm, grupo_id: Number(planForm.grupo_id) }),
        },
      );
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.error || "Erro ao salvar plano de conta.");
      toast.success(editingPlan ? "Plano de conta atualizado." : "Plano de conta criado.");
      setPlanDialogOpen(false);
      setExpandedGroups((current) => new Set(current).add(Number(planForm.grupo_id)));
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || "Erro ao salvar plano de conta.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="min-h-[460px]">
      <CardHeader className="border-b">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FolderTree className="h-5 w-5" /> Planos de conta
            </CardTitle>
            <CardDescription>
              {groups.length} grupo(s) · {plans.length} plano(s) de conta
            </CardDescription>
          </div>
          <Button size="sm" onClick={openNewGroup}>
            <Plus className="mr-1 h-4 w-4" /> Novo grupo
          </Button>
        </div>
        <div className="flex min-w-0 gap-2 pt-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar grupo, código ou plano de conta..."
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="icon" onClick={() => void loadData()} disabled={loading} title="Recarregar">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 p-3 sm:p-5">
        {loading ? (
          <div className="grid min-h-48 place-items-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : visibleGroups.length === 0 ? (
          <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
            Nenhum grupo ou plano de conta encontrado.
          </div>
        ) : visibleGroups.map((group) => {
          const groupPlans = plansForGroup(group.id);
          const expanded = Boolean(search.trim()) || expandedGroups.has(group.id);
          return (
            <Collapsible
              key={group.id}
              open={expanded}
              onOpenChange={(open) => setExpandedGroups((current) => {
                const next = new Set(current);
                if (open) next.add(group.id);
                else next.delete(group.id);
                return next;
              })}
              className="min-w-0 overflow-hidden rounded-lg border bg-card"
            >
              <div className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                <CollapsibleTrigger asChild>
                  <button type="button" className="flex min-w-0 flex-1 items-start gap-3 text-left">
                    {expanded
                      ? <ChevronDown className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                      : <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm text-muted-foreground">{group.codigo}</span>
                        <span className="font-semibold">{group.nome}</span>
                        <Badge variant={group.ativo ? "default" : "outline"}>
                          {group.ativo ? "Ativo" : "Inativo"}
                        </Badge>
                        <Badge variant="secondary">{groupPlans.length} plano(s)</Badge>
                      </div>
                      {group.descricao ? (
                        <p className="mt-1 break-words text-xs text-muted-foreground">{group.descricao}</p>
                      ) : null}
                    </div>
                  </button>
                </CollapsibleTrigger>
                <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
                  <Button type="button" size="sm" variant="outline" onClick={() => openNewPlan(group)}>
                    <Plus className="mr-1 h-4 w-4" /> Plano de conta
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="icon" aria-label={`Opções de ${group.nome}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditGroup(group)}>
                        <Pencil className="mr-2 h-4 w-4" /> Editar grupo
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <CollapsibleContent>
                <div className="border-t bg-muted/15 p-2 sm:p-3">
                  {groupPlans.length === 0 ? (
                    <div className="rounded-md border border-dashed bg-background py-8 text-center text-sm text-muted-foreground">
                      Este grupo ainda não possui planos de conta.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {groupPlans.map((plan) => (
                        <div
                          key={plan.id}
                          className="grid min-w-0 gap-2 rounded-md border bg-background p-3 md:grid-cols-[110px_minmax(180px,1fr)_minmax(220px,1.4fr)_90px_40px] md:items-center"
                        >
                          <div>
                            <span className="text-xs text-muted-foreground md:hidden">Código</span>
                            <p className="font-mono text-sm">{plan.codigo || "—"}</p>
                          </div>
                          <div className="min-w-0">
                            <span className="text-xs text-muted-foreground md:hidden">Plano de conta</span>
                            <p className="break-words font-medium">{plan.nome}</p>
                          </div>
                          <div className="min-w-0">
                            <span className="text-xs text-muted-foreground md:hidden">Descrição</span>
                            <p className="break-words text-sm text-muted-foreground">{plan.descricao || "—"}</p>
                          </div>
                          <Badge variant={plan.ativo ? "default" : "outline"} className="w-fit">
                            {plan.ativo ? "Ativo" : "Inativo"}
                          </Badge>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditPlan(plan)}
                            title="Editar plano de conta"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </CardContent>

      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingGroup ? "Editar grupo" : "Novo grupo"}</DialogTitle>
            <DialogDescription>O grupo organiza os planos de conta exibidos nas transações.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-[120px_1fr]">
            <div className="space-y-1.5">
              <Label>Código *</Label>
              <Input value={groupForm.codigo} onChange={(event) => setGroupForm((current) => ({ ...current, codigo: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input value={groupForm.nome} onChange={(event) => setGroupForm((current) => ({ ...current, nome: event.target.value }))} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Descrição</Label>
              <Textarea value={groupForm.descricao} onChange={(event) => setGroupForm((current) => ({ ...current, descricao: event.target.value }))} />
            </div>
            <StatusField ativo={groupForm.ativo} onChange={(ativo) => setGroupForm((current) => ({ ...current, ativo }))} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setGroupDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => void saveGroup()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Salvar grupo
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingPlan ? "Editar plano de conta" : "Novo plano de conta"}</DialogTitle>
            <DialogDescription>Cadastre o plano dentro de um grupo e defina seu código contábil.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 p-4 bg-card rounded-2xl sm:grid-cols-2 ">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Grupo *</Label>
              <Select value={planForm.grupo_id} onValueChange={(grupo_id) => setPlanForm((current) => ({ ...current, grupo_id }))}>
                <SelectTrigger><SelectValue placeholder="Selecione o grupo" /></SelectTrigger>
                <SelectContent>
                  {groups.map((group) => (
                    <SelectItem key={group.id} value={String(group.id)}>
                      {group.codigo} - {group.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Código *</Label>
              <Input value={planForm.codigo} onChange={(event) => setPlanForm((current) => ({ ...current, codigo: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input value={planForm.nome} onChange={(event) => setPlanForm((current) => ({ ...current, nome: event.target.value }))} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Descrição</Label>
              <Textarea value={planForm.descricao} onChange={(event) => setPlanForm((current) => ({ ...current, descricao: event.target.value }))} />
            </div>
            <StatusField ativo={planForm.ativo} onChange={(ativo) => setPlanForm((current) => ({ ...current, ativo }))} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPlanDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => void savePlan()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Salvar plano
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function StatusField({ ativo, onChange }: { ativo: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2 sm:col-span-2">
      <div>
        <p className="text-sm font-medium">Status</p>
        <p className="text-xs text-muted-foreground">Itens inativos não aparecem nas transações.</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{ativo ? "Ativo" : "Inativo"}</span>
        <Switch checked={ativo} onCheckedChange={onChange} />
      </div>
    </div>
  );
}
