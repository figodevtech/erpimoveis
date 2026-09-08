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

type Destino = {
  situacao: string;
  linha_codigo: string | null;
  linha_nome: string | null;
  motivo: string | null;
};

type Classificacao = {
  codigo: string;
  nome: string;
  familia: string | null;
  tratamento: string | null;
  herdada?: boolean;
  origem?: string | null;
};

type ClassificacaoCatalogo = {
  id: number;
  codigo: string;
  nome: string;
  descricao: string;
  familia: string;
  tratamento: string;
  naturezas: string[];
  destino: { fora_da_dre: boolean; linha_codigo: string | null; linha_nome: string | null } | null;
};

type PlanoContaGrupo = {
  id: number;
  codigo: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  origem_cadastro: string;
  versao_registro: number;
  classificacao: Classificacao | null;
  destino: Destino;
  contas: number;
};

type PlanoConta = {
  id: number;
  codigo: string | null;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  grupo_id: number;
  origem_cadastro: string;
  versao_registro: number;
  classificacao_especifica: string | null;
  classificacao: Classificacao | null;
  destino: Destino;
  transacoes: number;
};

type GroupForm = {
  codigo: string;
  nome: string;
  descricao: string;
  ativo: boolean;
  classificacao_id: string;
  vigencia_inicio: string;
};

type PlanForm = Omit<GroupForm, "classificacao_id"> & {
  grupo_id: string;
  classificacao_id: string;
};

/** "" no select significa herdar o grupo; o campo só vira `null` no envio. */
const HERDAR = "__herdar__";

const emptyGroupForm: GroupForm = {
  codigo: "",
  nome: "",
  descricao: "",
  ativo: true,
  classificacao_id: HERDAR,
  vigencia_inicio: "",
};
const emptyPlanForm: PlanForm = { ...emptyGroupForm, grupo_id: "" };

function compareCodes(first?: string | null, second?: string | null) {
  return String(first ?? "").localeCompare(String(second ?? ""), "pt-BR", {
    numeric: true,
    sensitivity: "base",
  });
}

/** Explicação curta do destino, em linguagem de oficina e não de contabilidade. */
function textoDoDestino(destino: Destino) {
  if (destino.situacao === "CLASSIFICADO" && destino.linha_codigo) {
    return `DRE ${destino.linha_codigo} · ${destino.linha_nome ?? ""}`.trim();
  }
  if (destino.situacao === "EXCLUIDO") return "Fora da DRE";
  return "Sem classificação";
}

function DestinoBadge({ destino }: { destino: Destino }) {
  const variante =
    destino.situacao === "CLASSIFICADO" ? "secondary" : destino.situacao === "EXCLUIDO" ? "outline" : "destructive";
  return (
    <Badge variant={variante} className="w-fit font-normal" title={destino.motivo ?? undefined}>
      {textoDoDestino(destino)}
    </Badge>
  );
}

export default function PlanosDeContaSection() {
  const [groups, setGroups] = useState<PlanoContaGrupo[]>([]);
  const [plans, setPlans] = useState<PlanoConta[]>([]);
  const [catalogo, setCatalogo] = useState<ClassificacaoCatalogo[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [filtroSituacao, setFiltroSituacao] = useState("todas");
  const [filtroOrigem, setFiltroOrigem] = useState("todas");
  const [filtroStatus, setFiltroStatus] = useState("todos");
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
      const [groupsResponse, plansResponse, catalogoResponse] = await Promise.all([
        fetch("/api/tipos/grupos-planos-de-conta", { cache: "no-store" }),
        fetch("/api/tipos/planos-de-conta", { cache: "no-store" }),
        fetch("/api/tipos/classificacoes-resultado", { cache: "no-store" }),
      ]);
      const [groupsJson, plansJson, catalogoJson] = await Promise.all([
        groupsResponse.json(),
        plansResponse.json(),
        catalogoResponse.json(),
      ]);
      if (!groupsResponse.ok) throw new Error(groupsJson?.error || "Erro ao carregar grupos.");
      if (!plansResponse.ok) throw new Error(plansJson?.error || "Erro ao carregar planos de conta.");
      if (!catalogoResponse.ok) throw new Error(catalogoJson?.error || "Erro ao carregar classificações.");

      const nextGroups: PlanoContaGrupo[] = (groupsJson.items ?? [])
        .map((group: any) => ({
          id: Number(group.id),
          codigo: String(group.codigo ?? ""),
          nome: String(group.nome ?? ""),
          descricao: group.descricao ?? null,
          ativo: typeof group.ativo === "boolean" ? group.ativo : true,
          origem_cadastro: String(group.origem_cadastro ?? "PERSONALIZADO"),
          versao_registro: Number(group.versao_registro ?? 1),
          classificacao: group.classificacao ?? null,
          destino: group.destino ?? { situacao: "PENDENTE", linha_codigo: null, linha_nome: null, motivo: null },
          contas: Number(group.contas ?? 0),
        }))
        .sort((first: PlanoContaGrupo, second: PlanoContaGrupo) => compareCodes(first.codigo, second.codigo));

      const nextPlans: PlanoConta[] = (plansJson.items ?? [])
        .map((plan: any) => ({
          id: Number(plan.id),
          codigo: plan.codigo ?? null,
          nome: String(plan.nome ?? ""),
          descricao: plan.descricao ?? null,
          ativo: typeof plan.ativo === "boolean" ? plan.ativo : true,
          grupo_id: Number(plan.grupo_id),
          origem_cadastro: String(plan.origem_cadastro ?? "PERSONALIZADO"),
          versao_registro: Number(plan.versao_registro ?? 1),
          classificacao_especifica: plan.classificacao_especifica ?? null,
          classificacao: plan.classificacao ?? null,
          destino: plan.destino ?? { situacao: "PENDENTE", linha_codigo: null, linha_nome: null, motivo: null },
          transacoes: Number(plan.transacoes ?? 0),
        }))
        .sort((first: PlanoConta, second: PlanoConta) => compareCodes(first.codigo, second.codigo));

      setGroups(nextGroups);
      setPlans(nextPlans);
      setCatalogo((catalogoJson.items ?? []) as ClassificacaoCatalogo[]);
    } catch (error: any) {
      toast.error(error?.message || "Erro ao carregar planos de conta.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const pendentes = useMemo(
    () => plans.filter((plan) => plan.destino.situacao === "PENDENTE").length,
    [plans],
  );

  function planoPassaNosFiltros(plan: PlanoConta) {
    if (filtroSituacao !== "todas" && plan.destino.situacao !== filtroSituacao) return false;
    if (filtroOrigem !== "todas" && plan.origem_cadastro !== filtroOrigem) return false;
    if (filtroStatus === "ativos" && !plan.ativo) return false;
    if (filtroStatus === "inativos" && plan.ativo) return false;
    return true;
  }

  function textoDoPlano(plan: PlanoConta) {
    return `${plan.codigo ?? ""} ${plan.nome} ${plan.descricao ?? ""}`.toLocaleLowerCase("pt-BR");
  }

  function textoDoGrupo(group: PlanoContaGrupo | undefined) {
    return `${group?.codigo ?? ""} ${group?.nome ?? ""} ${group?.descricao ?? ""}`.toLocaleLowerCase("pt-BR");
  }

  function plansForGroup(groupId: number) {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    const group = groups.find((item) => item.id === groupId);
    return plans.filter((plan) => {
      if (plan.grupo_id !== groupId) return false;
      if (!planoPassaNosFiltros(plan)) return false;
      if (!term) return true;
      return textoDoGrupo(group).includes(term) || textoDoPlano(plan).includes(term);
    });
  }

  const visibleGroups = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return groups.filter((group) => {
      const contasDoGrupo = plans.filter((plan) => plan.grupo_id === group.id);
      const filtradas = contasDoGrupo.filter(planoPassaNosFiltros);

      // Um grupo sem conta nenhuma continua visível: é justamente ele que pode
      // estar sem destino, e esconder um cadastro incompleto não o resolve.
      const filtroDeConta = filtroSituacao !== "todas" || filtroOrigem !== "todas" || filtroStatus !== "todos";
      if (filtroDeConta && contasDoGrupo.length > 0 && filtradas.length === 0) return false;
      if (filtroDeConta && contasDoGrupo.length === 0) {
        if (filtroSituacao !== "todas" && group.destino.situacao !== filtroSituacao) return false;
        if (filtroOrigem !== "todas" && group.origem_cadastro !== filtroOrigem) return false;
        if (filtroStatus === "ativos" && !group.ativo) return false;
        if (filtroStatus === "inativos" && group.ativo) return false;
      }

      if (!term) return true;
      return textoDoGrupo(group).includes(term) || filtradas.some((plan) => textoDoPlano(plan).includes(term));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, plans, search, filtroSituacao, filtroOrigem, filtroStatus]);

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

  function classificacaoPorCodigo(codigo: string | null) {
    return codigo ? catalogo.find((item) => item.codigo === codigo) ?? null : null;
  }

  function openNewGroup() {
    setEditingGroup(null);
    setGroupForm({ ...emptyGroupForm, codigo: suggestGroupCode() });
    setGroupDialogOpen(true);
  }

  function openEditGroup(group: PlanoContaGrupo) {
    setEditingGroup(group);
    const atual = classificacaoPorCodigo(group.classificacao?.codigo ?? null);
    setGroupForm({
      codigo: group.codigo,
      nome: group.nome,
      descricao: group.descricao ?? "",
      ativo: group.ativo,
      classificacao_id: atual ? String(atual.id) : HERDAR,
      vigencia_inicio: "",
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
    const excecao = classificacaoPorCodigo(plan.classificacao_especifica);
    setPlanForm({
      grupo_id: String(plan.grupo_id),
      codigo: plan.codigo ?? "",
      nome: plan.nome,
      descricao: plan.descricao ?? "",
      ativo: plan.ativo,
      classificacao_id: excecao ? String(excecao.id) : HERDAR,
      vigencia_inicio: "",
    });
    setPlanDialogOpen(true);
  }

  const grupoDoFormulario = useMemo(
    () => groups.find((group) => String(group.id) === planForm.grupo_id) ?? null,
    [groups, planForm.grupo_id],
  );

  /**
   * A exceção precisa ficar na mesma família do grupo. Filtrar aqui dá a resposta
   * na hora; a RPC repete a regra, porque a tela não é a única forma de gravar.
   */
  const excecoesPossiveis = useMemo(() => {
    const familia = grupoDoFormulario?.classificacao?.familia ?? null;
    if (!familia) return catalogo;
    return catalogo.filter((item) => item.familia === familia);
  }, [catalogo, grupoDoFormulario]);

  async function enviar(url: string, method: string, body: unknown, generico: string) {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => null);
    if (response.status === 409) {
      // Alguém salvou entre a leitura e o envio. Recarregar é o único caminho
      // honesto: gravar por cima apagaria o que a outra pessoa decidiu.
      await loadData();
      throw new Error(json?.error || "Este cadastro mudou enquanto você editava. A lista foi recarregada.");
    }
    if (!response.ok) throw new Error(json?.error || generico);
    return json;
  }

  async function saveGroup() {
    if (!groupForm.codigo.trim() || !groupForm.nome.trim()) {
      toast.error("Informe o código e o nome do grupo.");
      return;
    }
    try {
      setSaving(true);
      await enviar(
        editingGroup
          ? `/api/tipos/grupos-planos-de-conta/${editingGroup.id}`
          : "/api/tipos/grupos-planos-de-conta",
        editingGroup ? "PUT" : "POST",
        {
          codigo: groupForm.codigo,
          nome: groupForm.nome,
          descricao: groupForm.descricao,
          ativo: groupForm.ativo,
          classificacao_id: groupForm.classificacao_id === HERDAR ? null : Number(groupForm.classificacao_id),
          vigencia_inicio: groupForm.vigencia_inicio || null,
          versao_registro: editingGroup?.versao_registro ?? null,
        },
        "Erro ao salvar grupo.",
      );
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
      await enviar(
        editingPlan ? `/api/tipos/planos-de-conta/${editingPlan.id}` : "/api/tipos/planos-de-conta",
        editingPlan ? "PUT" : "POST",
        {
          codigo: planForm.codigo,
          nome: planForm.nome,
          descricao: planForm.descricao,
          ativo: planForm.ativo,
          grupo_id: Number(planForm.grupo_id),
          classificacao_id: planForm.classificacao_id === HERDAR ? null : Number(planForm.classificacao_id),
          vigencia_inicio: planForm.vigencia_inicio || null,
          versao_registro: editingPlan?.versao_registro ?? null,
        },
        "Erro ao salvar plano de conta.",
      );
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
              {pendentes > 0 ? ` · ${pendentes} sem classificação` : ""}
            </CardDescription>
          </div>
          <Button size="sm" onClick={openNewGroup}>
            <Plus className="mr-1 h-4 w-4" /> Novo grupo
          </Button>
        </div>
        <div className="flex min-w-0 flex-col gap-2 pt-2 lg:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar grupo, código ou plano de conta..."
              className="pl-9"
            />
          </div>
          <div className="flex gap-2">
            <Select value={filtroSituacao} onValueChange={setFiltroSituacao}>
              <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Toda classificação</SelectItem>
                <SelectItem value="CLASSIFICADO">Na DRE</SelectItem>
                <SelectItem value="EXCLUIDO">Fora da DRE</SelectItem>
                <SelectItem value="PENDENTE">Sem classificação</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroOrigem} onValueChange={setFiltroOrigem}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Toda origem</SelectItem>
                <SelectItem value="SISTEMA">Do sistema</SelectItem>
                <SelectItem value="PERSONALIZADO">Da oficina</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="ativos">Ativos</SelectItem>
                <SelectItem value="inativos">Inativos</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => void loadData()} disabled={loading} title="Recarregar">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
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
                        {group.origem_cadastro === "SISTEMA" ? (
                          <Badge variant="secondary" className="font-normal">Sistema</Badge>
                        ) : null}
                        <Badge variant={group.ativo ? "default" : "outline"}>
                          {group.ativo ? "Ativo" : "Inativo"}
                        </Badge>
                        <Badge variant="secondary">{groupPlans.length} plano(s)</Badge>
                        <DestinoBadge destino={group.destino} />
                      </div>
                      {group.destino.situacao === "EXCLUIDO" && group.destino.motivo ? (
                        <p className="mt-1 break-words text-xs text-muted-foreground">{group.destino.motivo}</p>
                      ) : group.descricao ? (
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
                          className="grid min-w-0 gap-2 rounded-md border bg-background p-3 md:grid-cols-[110px_minmax(180px,1fr)_minmax(200px,1.2fr)_90px_40px] md:items-center"
                        >
                          <div>
                            <span className="text-xs text-muted-foreground md:hidden">Código</span>
                            <p className="font-mono text-sm">{plan.codigo || "—"}</p>
                          </div>
                          <div className="min-w-0">
                            <span className="text-xs text-muted-foreground md:hidden">Plano de conta</span>
                            <p className="break-words font-medium">{plan.nome}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              {plan.origem_cadastro === "SISTEMA" ? (
                                <Badge variant="secondary" className="font-normal">Sistema</Badge>
                              ) : null}
                              {plan.classificacao?.herdada && plan.classificacao ? (
                                <Badge variant="outline" className="font-normal">Herdada</Badge>
                              ) : null}
                              {plan.classificacao_especifica ? (
                                <Badge variant="outline" className="font-normal">Exceção</Badge>
                              ) : null}
                            </div>
                          </div>
                          <div className="min-w-0">
                            <span className="text-xs text-muted-foreground md:hidden">Destino na DRE</span>
                            <DestinoBadge destino={plan.destino} />
                            <p className="mt-1 break-words text-xs text-muted-foreground">
                              {plan.destino.situacao === "EXCLUIDO" && plan.destino.motivo
                                ? plan.destino.motivo
                                : plan.classificacao?.nome ?? plan.descricao ?? "—"}
                            </p>
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
            <DialogDescription>
              O grupo organiza os planos de conta e define o destino que as contas dele herdam na DRE.
            </DialogDescription>
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
              <Label>Classificação padrão</Label>
              <Select
                value={groupForm.classificacao_id}
                onValueChange={(classificacao_id) => setGroupForm((current) => ({ ...current, classificacao_id }))}
                disabled={editingGroup?.origem_cadastro === "SISTEMA"}
              >
                <SelectTrigger><SelectValue placeholder="Sem classificação" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={HERDAR}>Sem classificação (fica pendente)</SelectItem>
                  {catalogo.map((item) => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.nome}
                      {item.destino?.fora_da_dre
                        ? " · fora da DRE"
                        : item.destino?.linha_codigo
                          ? ` · DRE ${item.destino.linha_codigo}`
                          : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {editingGroup?.origem_cadastro === "SISTEMA"
                  ? "Grupo do sistema: o nome é seu, a finalidade não muda."
                  : "As contas deste grupo sem exceção própria herdam esta classificação."}
              </p>
            </div>
            {editingGroup ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Vale a partir de</Label>
                <Input
                  type="date"
                  value={groupForm.vigencia_inicio}
                  onChange={(event) => setGroupForm((current) => ({ ...current, vigencia_inicio: event.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  Competências anteriores continuam com o destino atual. Em branco, vale de hoje em diante.
                </p>
              </div>
            ) : null}
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
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingPlan ? "Editar plano de conta" : "Novo plano de conta"}</DialogTitle>
            <DialogDescription>Cadastre o plano dentro de um grupo e defina seu código contábil.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 rounded-2xl bg-card p-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Grupo *</Label>
              <Select
                value={planForm.grupo_id}
                onValueChange={(grupo_id) =>
                  setPlanForm((current) => ({ ...current, grupo_id, classificacao_id: HERDAR }))
                }
                disabled={editingPlan?.origem_cadastro === "SISTEMA"}
              >
                <SelectTrigger><SelectValue placeholder="Selecione o grupo" /></SelectTrigger>
                <SelectContent>
                  {groups.map((group) => (
                    <SelectItem key={group.id} value={String(group.id)}>
                      {group.codigo} - {group.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {grupoDoFormulario ? (
                <p className="text-xs text-muted-foreground">
                  {grupoDoFormulario.classificacao
                    ? `Sem exceção, esta conta vai para: ${textoDoDestino(grupoDoFormulario.destino)}.`
                    : "Este grupo ainda não tem classificação: a conta ficará pendente até alguém definir."}
                </p>
              ) : null}
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
              <Label>Classificação específica</Label>
              <Select
                value={planForm.classificacao_id}
                onValueChange={(classificacao_id) => setPlanForm((current) => ({ ...current, classificacao_id }))}
                disabled={editingPlan?.origem_cadastro === "SISTEMA"}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={HERDAR}>Herdar do grupo</SelectItem>
                  {excecoesPossiveis.map((item) => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.nome}
                      {item.destino?.fora_da_dre
                        ? " · fora da DRE"
                        : item.destino?.linha_codigo
                          ? ` · DRE ${item.destino.linha_codigo}`
                          : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Use só quando esta conta tiver destino diferente do grupo. Mudar entre receita, despesa e
                patrimônio exige trocar de grupo.
              </p>
            </div>
            {editingPlan ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Vale a partir de</Label>
                <Input
                  type="date"
                  value={planForm.vigencia_inicio}
                  onChange={(event) => setPlanForm((current) => ({ ...current, vigencia_inicio: event.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  {editingPlan.transacoes > 0
                    ? `Esta conta tem ${editingPlan.transacoes} lançamento(s). Competências anteriores mantêm o destino atual.`
                    : "Competências anteriores continuam com o destino atual."}
                </p>
              </div>
            ) : null}
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
