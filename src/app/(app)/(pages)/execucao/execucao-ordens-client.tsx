"use client";

import * as React from "react";
import { toast } from "@/lib/toast";
import {
  CalendarDays,
  CheckCircle2,
  Loader2,
  Play,
  RefreshCcw,
  Search,
  UserRound,
  Wrench,
  Clock,
  LayoutGrid,
  SlidersHorizontal,
} from "lucide-react";
import { useRealtimeTabelas } from "@/hooks/use-realtime-tabelas";

/** Módulo, não literal: um array novo a cada render reiniciaria a inscrição. */
const TABELAS_REALTIME = ["ordemservico", "osservico", "osservico_realizador"];

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type RealizadorExecucao = {
  id: string;
  nome: string | null;
  statusExecucao: "PENDENTE" | "EM_EXECUCAO" | "FINALIZADO";
  iniciadoEm: string | null;
  finalizadoEm: string | null;
  observacao: string | null;
  meu: boolean;
};

type ProdutoExecucao = {
  id: number;
  titulo: string;
  quantidade: number;
  subtotal: number;
};

type SetorOption = {
  id: number;
  nome: string;
};

type ServicoExecucao = {
  ordemservicoid: number;
  servicoid: number;
  descricao: string;
  observacao: string | null;
  quantidade: number;
  subtotal: number;
  realizadores: RealizadorExecucao[];
  minhaExecucao: RealizadorExecucao | null;
};

type OrdemExecucao = {
  id: number;
  descricao: string;
  prioridade: "BAIXA" | "NORMAL" | "ALTA";
  status: string | null;
  dataEntrada: string | null;
  orcamentoTotal: number;
  alvoTipo: "VEICULO" | "PECA";
  cliente: { id: number; nome: string; telefone: string | null } | null;
  veiculo: { id: number; placa: string | null; modelo: string | null; marca: string | null } | null;
  peca: { id: number; titulo: string; descricao: string | null; lacre: string | null } | null;
  setor: { id: number; nome: string } | null;
  progresso: { totalServicos: number; servicosFinalizados: number };
  servicos: ServicoExecucao[];
  produtos: ProdutoExecucao[];
};

type FinalizarTarget = {
  ordem: OrdemExecucao;
  servico: ServicoExecucao;
};

type AssumirTarget = {
  ordem: OrdemExecucao;
};

type EstoqueInsuficienteItem = {
  id: number;
  titulo: string;
  disponivel: number;
  solicitado: number;
};

type EstoqueInsuficienteDialog = {
  osId: number;
  message: string;
  itens: EstoqueInsuficienteItem[];
};

const execLabel: Record<string, string> = {
  PENDENTE: "Pendente",
  EM_EXECUCAO: "Em execucao",
  FINALIZADO: "Finalizado",
};

function formatTimeDiff(startIso: string, nowMs: number) {
  const start = new Date(startIso).getTime();
  const diff = Math.max(0, nowMs - start);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const execBadgeClass = (status?: string | null) => {
  switch (status) {
    case "EM_EXECUCAO":
      return "border-blue-500/30 bg-blue-500/10 text-blue-600";
    case "FINALIZADO":
      return "border-green-500/30 bg-green-500/10 text-green-600";
    default:
      return "border-muted bg-muted/40 text-muted-foreground";
  }
};

function getOrdemExecucaoStatus(ordem: OrdemExecucao) {
  if (ordem.progresso.totalServicos > 0 && ordem.progresso.servicosFinalizados >= ordem.progresso.totalServicos) {
    return "FINALIZADO";
  }

  const minhasExecucoes = ordem.servicos
    .map((servico) => servico.minhaExecucao?.statusExecucao ?? null)
    .filter(Boolean);

  if (minhasExecucoes.includes("EM_EXECUCAO")) return "EM_EXECUCAO";
  return "PENDENTE";
}

// Item memoizado para evitar re-render de toda a lista ao marcar/desmarcar
const ServicoItem = React.memo(function ServicoItem({
  servico,
  checked,
  onToggle,
}: {
  servico: { servicoid: number; descricao: string; observacao: string | null; quantidade: number };
  checked: boolean;
  onToggle: (id: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(servico.servicoid)}
      className={`w-full rounded-lg border p-3 text-left transition-colors hover:cursor-pointer ${
        checked ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40"
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
            checked ? "bg-primary border-primary" : "border-border"
          }`}
        >
          {checked && <CheckCircle2 className="h-3 w-3 text-primary-foreground" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground leading-tight truncate">
            {servico.descricao}
            {servico.observacao ? (
              <span className="font-normal text-muted-foreground"> - {servico.observacao}</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Qtd: {servico.quantidade || 1}</p>
        </div>
      </div>
    </button>
  );
});

export default function ExecucaoOrdensClient() {
  const [tab, setTab] = React.useState("ativas");
  const [q, setQ] = React.useState("");
  const [ordens, setOrdens] = React.useState<OrdemExecucao[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [syncing, setSyncing] = React.useState(false);
  const [realtimeNotice, setRealtimeNotice] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [finalizarTarget, setFinalizarTarget] = React.useState<FinalizarTarget | null>(null);
  const [assumirTarget, setAssumirTarget] = React.useState<AssumirTarget | null>(null);
  const [servicosSelecionados, setServicosSelecionados] = React.useState<number[]>([]);
  const [buscaServico, setBuscaServico] = React.useState("");
  const [observacao, setObservacao] = React.useState("");
  const [now, setNow] = React.useState(Date.now());
  const [filtroSetor, setFiltroSetor] = React.useState<string>("todos");
  const [filtroPrioridade, setFiltroPrioridade] = React.useState<string>("todos");
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [hasSetDefaultSetor, setHasSetDefaultSetor] = React.useState(false);
  const [setoresDisponiveis, setSetoresDisponiveis] = React.useState<SetorOption[]>([]);
  const [estoqueDialog, setEstoqueDialog] = React.useState<EstoqueInsuficienteDialog | null>(null);
  const realtimeTimerRef = React.useRef<number | null>(null);

  // Tick para cronometros
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const loadOrdens = React.useCallback(
    async (options?: { silent?: boolean; realtime?: boolean }) => {
      const silent = options?.silent === true;

      try {
        if (silent) {
          setSyncing(true);
        } else {
          setLoading(true);
          setErro(null);
          setRealtimeNotice(null);
        }

        const params = new URLSearchParams({ status: tab });
        if (q.trim()) params.set("q", q.trim());
        if (filtroSetor) params.set("setorId", filtroSetor);
        if (filtroPrioridade) params.set("prioridade", filtroPrioridade);

        const res = await fetch(`/api/execucao/ordens?${params.toString()}`, {
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Falha ao carregar ordens");

        const items = (json.items ?? []) as OrdemExecucao[];
        setOrdens(items);

        if (options?.realtime) {
          setRealtimeNotice("Atualizado em tempo real");
          window.setTimeout(() => setRealtimeNotice(null), 2800);
        }

        // Definir setor padrão no primeiro carregamento
        if (!hasSetDefaultSetor && json.setorId) {
          setFiltroSetor(String(json.setorId));
          setHasSetDefaultSetor(true);
        }
      } catch (error: any) {
        const message = error?.message || "Falha ao carregar ordens";
        if (silent) {
          console.error("Falha ao sincronizar execucao em tempo real", error);
          setRealtimeNotice("Nao foi possivel sincronizar agora");
          window.setTimeout(() => setRealtimeNotice(null), 2800);
        } else {
          setErro(message);
          setOrdens([]);
        }
      } finally {
        if (silent) {
          setSyncing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [q, tab, filtroSetor, filtroPrioridade, hasSetDefaultSetor],
  );

  const ordensFiltradas = React.useMemo(() => {
    return ordens.filter((o) => {
      const matchSetor = filtroSetor === "todos" || String(o.setor?.id) === filtroSetor;
      const matchPrioridade = filtroPrioridade === "todos" || o.prioridade === filtroPrioridade;
      return matchSetor && matchPrioridade;
    });
  }, [ordens, filtroSetor, filtroPrioridade]);

  React.useEffect(() => {
    let alive = true;

    async function loadSetores() {
      try {
        const res = await fetch("/api/tipos/setores", { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Falha ao carregar setores");

        if (!alive) return;

        const items = (json.items ?? json.data ?? [])
          .map((setor: any) => ({
            id: Number(setor.id),
            nome: String(setor.nome ?? ""),
          }))
          .filter((setor: SetorOption) => Number.isFinite(setor.id) && setor.nome);

        setSetoresDisponiveis(items);
      } catch (error) {
        console.error("Falha ao carregar setores da execucao", error);
      }
    }

    void loadSetores();

    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    void loadOrdens();
  }, [loadOrdens]);

  // Realtime Supabase: OS principal (status), realizadores (quem iniciou ou
  // finalizou) e serviços da OS (adição/remoção).
  //
  // Isto dependia de `loadOrdens`, que muda de identidade junto com o campo de
  // busca — cada tecla digitada aqui derrubava e recriava três inscrições.
  useRealtimeTabelas(TABELAS_REALTIME, () => {
    setRealtimeNotice("Alteracao detectada. Sincronizando...");

    if (realtimeTimerRef.current) {
      window.clearTimeout(realtimeTimerRef.current);
    }

    realtimeTimerRef.current = window.setTimeout(() => {
      void loadOrdens({ silent: true, realtime: true });
    }, 450);
  });

  React.useEffect(() => () => {
    if (realtimeTimerRef.current) {
      window.clearTimeout(realtimeTimerRef.current);
      realtimeTimerRef.current = null;
    }
  }, []);

  const servicosAssumiveis = React.useMemo(() => {
    const ordem = assumirTarget?.ordem;
    if (!ordem) return [];

    const busca = buscaServico.trim().toLowerCase();
    const servicos = ordem.servicos.filter((servico) => {
      const minha = servico.minhaExecucao;
      return !minha || minha.statusExecucao === "PENDENTE";
    });

    if (!busca) return servicos;
    return servicos.filter((servico) => {
      return servico.descricao.toLowerCase().includes(busca) || String(servico.servicoid).includes(busca);
    });
  }, [assumirTarget, buscaServico]);

  function abrirAssumirServicos(ordem: OrdemExecucao) {
    const assumiveis = ordem.servicos
      .filter((servico) => !servico.minhaExecucao || servico.minhaExecucao.statusExecucao === "PENDENTE")
      .map((servico) => servico.servicoid);

    setAssumirTarget({ ordem });
    setServicosSelecionados(assumiveis.length === 1 ? assumiveis : []);
    setBuscaServico("");
  }

  const toggleServicoSelecionado = React.useCallback((servicoId: number) => {
    setServicosSelecionados((prev) => {
      if (prev.includes(servicoId)) return prev.filter((id) => id !== servicoId);
      return [...prev, servicoId];
    });
  }, []);

  async function iniciarServicosSelecionados() {
    const ordem = assumirTarget?.ordem;
    if (!ordem) return;

    const selecionados = ordem.servicos.filter((servico) => servicosSelecionados.includes(servico.servicoid));

    if (selecionados.length === 0) {
      toast.error("Selecione ao menos um servico.");
      return;
    }

    const key = `${ordem.id}:bulk-iniciar`;
    try {
      setBusyKey(key);

      for (const servico of selecionados) {
        const res = await fetch(`/api/execucao/ordens/${ordem.id}/servicos/${servico.servicoid}/iniciar`, {
          method: "POST",
        });
        const json = await res.json().catch(() => ({}));
        if (res.status === 409 && Array.isArray(json?.itens)) {
          setEstoqueDialog({
            osId: ordem.id,
            message: json?.error || "Produtos do orçamento sem estoque suficiente.",
            itens: json.itens.map((item: any) => ({
              id: Number(item.id),
              titulo: String(item.titulo ?? `Produto #${item.id}`),
              disponivel: Number(item.disponivel ?? 0),
              solicitado: Number(item.solicitado ?? 0),
            })),
          });
          return;
        }
        if (!res.ok) throw new Error(json?.error || `Falha ao iniciar ${servico.descricao}`);
      }

      toast.success(selecionados.length === 1 ? "Servico iniciado." : `${selecionados.length} servicos iniciados.`);
      setAssumirTarget(null);
      setServicosSelecionados([]);
      setBuscaServico("");
      await loadOrdens({ silent: true });
    } catch (error: any) {
      toast.error(error?.message || "Falha ao iniciar servicos");
    } finally {
      setBusyKey(null);
    }
  }

  async function confirmarFinalizacao() {
    if (!finalizarTarget) return;

    const { ordem, servico } = finalizarTarget;
    const key = `${ordem.id}:${servico.servicoid}:finalizar`;

    try {
      setBusyKey(key);
      const res = await fetch(`/api/execucao/ordens/${ordem.id}/servicos/${servico.servicoid}/finalizar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observacao }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Falha ao finalizar servico");

      if (json?.fluxo?.proximoSetorId) {
        toast.success("Sua parte foi finalizada e a OS foi enviada ao proximo setor.");
      } else if (json?.fluxo?.status === "PAGAMENTO") {
        toast.success("Sua parte foi finalizada e a OS foi enviada para pagamento.");
      } else {
        toast.success("Sua parte foi finalizada.");
      }

      setFinalizarTarget(null);
      setObservacao("");
      await loadOrdens({ silent: true });
    } catch (error: any) {
      toast.error(error?.message || "Falha ao finalizar servico");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 lg:flex lg:items-center lg:w-auto">
        <Button
          variant="outline"
          size="sm"
          className="w-full lg:w-auto"
          onClick={() => loadOrdens()}
          disabled={loading}
        >
          <RefreshCcw className={`mr-2 h-4 w-4 ${loading || syncing ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
        <div className="lg:hidden">
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="w-full gap-1 hover:cursor-pointer">
                <SlidersHorizontal className="h-4 w-4" />
                Filtros
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Filtros da listagem</SheetTitle>
              </SheetHeader>
              <div className="grid flex-1 auto-rows-min gap-6 px-4 mt-6">
                <div className="space-y-2">
                  <Label>Setor</Label>
                  <Select value={filtroSetor} onValueChange={setFiltroSetor}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos</SelectItem>
                      {setoresDisponiveis.map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Prioridade</Label>
                  <Select value={filtroPrioridade} onValueChange={setFiltroPrioridade}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Todas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todas</SelectItem>
                      <SelectItem value="ALTA">Alta</SelectItem>
                      <SelectItem value="NORMAL">Normal</SelectItem>
                      <SelectItem value="BAIXA">Baixa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="mt-2 flex justify-between gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    type="button"
                    onClick={() => {
                      setFiltroSetor("todos");
                      setFiltroPrioridade("todos");
                    }}
                  >
                    Limpar
                  </Button>
                  <Button className="flex-1" type="button" onClick={() => setSheetOpen(false)}>
                    Aplicar
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {realtimeNotice ? (
        <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          {syncing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
          )}
          <span>{realtimeNotice}</span>
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <Tabs value={tab} onValueChange={setTab} className="flex-1">
            <TabsList className="grid w-full grid-cols-2 h-10 p-1 bg-muted rounded-xl">
              <TabsTrigger
                value="ativas"
                className="group h-full rounded-lg border border-transparent text-sm font-medium text-muted-foreground transition-all hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
              >
                Em Execução
              </TabsTrigger>
              <TabsTrigger
                value="finalizadas"
                className="group h-full rounded-lg border border-transparent text-sm font-medium text-muted-foreground transition-all hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
              >
                Concluídas
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Filtros visíveis só no desktop (lg+) */}
          <div className="hidden lg:block">
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1 hover:cursor-pointer">
                  <SlidersHorizontal className="h-4 w-4" />
                  Filtros
                </Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Filtros da listagem</SheetTitle>
                </SheetHeader>

                <div className="grid flex-1 auto-rows-min gap-6 px-4 mt-6">
                  {/* Setor */}
                  <div className="space-y-2">
                    <Label>Setor</Label>
                    <Select value={filtroSetor} onValueChange={setFiltroSetor}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Todos" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todos">Todos</SelectItem>
                        {setoresDisponiveis.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            {s.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Prioridade */}
                  <div className="space-y-2">
                    <Label>Prioridade</Label>
                    <Select value={filtroPrioridade} onValueChange={setFiltroPrioridade}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Todas" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todos">Todas</SelectItem>
                        <SelectItem value="ALTA">Alta</SelectItem>
                        <SelectItem value="NORMAL">Normal</SelectItem>
                        <SelectItem value="BAIXA">Baixa</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="mt-2 flex justify-between gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      type="button"
                      onClick={() => {
                        setFiltroSetor("todos");
                        setFiltroPrioridade("todos");
                      }}
                    >
                      Limpar
                    </Button>
                    <Button className="flex-1" type="button" onClick={() => setSheetOpen(false)}>
                      Aplicar
                    </Button>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        <div className="relative">
          <Input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void loadOrdens();
            }}
            placeholder="Buscar placa ou OS..."
            className="h-12 pr-12 text-base border-2 rounded-xl shadow-sm font-medium"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 h-12 w-12"
            onClick={() => loadOrdens()}
          >
            <Search className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {erro ? (
        <Alert variant="destructive">
          <AlertTitle>Falha ao carregar</AlertTitle>
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="flex h-56 items-center justify-center rounded-md border bg-background">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Carregando ordens...</span>
        </div>
      ) : ordensFiltradas.length === 0 ? (
        <div className="flex h-56 flex-col items-center justify-center rounded-md border-2 border-dashed bg-background p-6 text-center text-sm text-muted-foreground">
          <LayoutGrid className="mb-2 h-8 w-8 opacity-20" />
          Nenhuma ordem encontrada com os filtros aplicados.
        </div>
      ) : (
        <div className="grid gap-4">
          {ordensFiltradas.map((ordem) => {
            const alvo =
              ordem.alvoTipo === "PECA"
                ? ordem.peca?.titulo || ordem.peca?.descricao || "Peca"
                : [ordem.veiculo?.marca, ordem.veiculo?.modelo, ordem.veiculo?.placa].filter(Boolean).join(" ") ||
                  "Veiculo";
            const assumiveisCount = ordem.servicos.filter(
              (servico) => !servico.minhaExecucao || servico.minhaExecucao.statusExecucao === "PENDENTE",
            ).length;
            const statusExecucaoOrdem = getOrdemExecucaoStatus(ordem);

            const priorityColor =
              ordem.prioridade === "ALTA"
                ? "border-l-destructive"
                : ordem.prioridade === "NORMAL"
                  ? "border-l-blue-500"
                  : "border-l-muted-foreground/30";

            return (
              <Card
                key={ordem.id}
                className={`overflow-hidden border-2 border-border/80 shadow-sm border-l-4 ${priorityColor} gap-0 py-0`}
              >
                {/* Header: OS e Status */}
                <div className="px-4 py-2 flex items-center justify-between border-b">
                  <span className="font-semibold text-muted-foreground">OS #{ordem.id}</span>
                  <Badge variant="outline" className={`text-xs font-medium ${execBadgeClass(statusExecucaoOrdem)}`}>
                    {execLabel[statusExecucaoOrdem] ?? statusExecucaoOrdem}
                  </Badge>
                </div>

                <CardContent className="p-0">
                  {/* Veiculo / Peça */}
                  <div className="px-4 py-3 border-b">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-lg font-semibold text-foreground">{alvo}</h3>
                        {ordem.veiculo?.placa ? (
                          <Badge variant="default" className="mt-2 text-sm font-semibold px-3 py-1">
                            {ordem.veiculo.placa}
                          </Badge>
                        ) : ordem.peca?.lacre ? (
                          <Badge
                            variant="outline"
                            className="mt-2 border-amber-500 bg-amber-50 text-amber-700 text-sm font-medium"
                          >
                            LACRE: {ordem.peca.lacre}
                          </Badge>
                        ) : null}

                        <div className="mt-2 flex items-center gap-4 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1.5">
                            <CalendarDays className="h-3.5 w-3.5" />
                            {ordem.dataEntrada ? new Date(ordem.dataEntrada).toLocaleDateString("pt-BR") : "-"}
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <div className="text-xs text-muted-foreground mb-0.5">Progresso</div>
                        <div className="text-base font-semibold text-primary tabular-nums">
                          {ordem.progresso.servicosFinalizados}/{ordem.progresso.totalServicos}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Lista de Serviços */}
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Wrench className="h-4 w-4 text-muted-foreground" /> SERVIÇOS
                      </h4>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-3 text-sm font-medium gap-1.5"
                        onClick={() => abrirAssumirServicos(ordem)}
                        disabled={tab !== "ativas" || assumiveisCount === 0 || busyKey === `${ordem.id}:bulk-iniciar`}
                      >
                        <LayoutGrid className="h-3.5 w-3.5" />
                        Gerenciar
                      </Button>
                    </div>

                    <div className="space-y-3">
                      {ordem.servicos.length === 0 ? (
                        <p className="text-sm italic text-muted-foreground">Nenhum serviço.</p>
                      ) : (
                        ordem.servicos.map((servico) => {
                          const minha = servico.minhaExecucao;
                          const keyBase = `${ordem.id}:${servico.servicoid}`;
                          const isBusy = busyKey === `${keyBase}:iniciar` || busyKey === `${keyBase}:finalizar`;
                          const servicoLabel = servico.observacao
                            ? `${servico.descricao} - ${servico.observacao}`
                            : servico.descricao;

                          return (
                            <div key={keyBase} className="rounded-lg border border-border p-3 bg-card mb-2 last:mb-0">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <TooltipProvider delayDuration={300}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className="flex min-w-0 items-center gap-2 cursor-default">
                                          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground leading-snug">
                                            {servico.descricao}
                                            {servico.observacao ? (
                                              <span className="font-normal text-muted-foreground">
                                                {" "}
                                                - {servico.observacao}
                                              </span>
                                            ) : null}
                                          </p>
                                          {minha?.statusExecucao ? (
                                            <Badge
                                              variant="outline"
                                              className={`shrink-0 px-2 py-0.5 text-xs font-medium ${execBadgeClass(minha.statusExecucao)}`}
                                            >
                                              {execLabel[minha.statusExecucao] ?? minha.statusExecucao}
                                            </Badge>
                                          ) : null}
                                        </div>
                                      </TooltipTrigger>
                                      {servico.observacao ? (
                                        <TooltipContent side="bottom" className="max-w-xs text-xs">
                                          {servicoLabel}
                                        </TooltipContent>
                                      ) : (
                                        <TooltipContent side="bottom" className="max-w-xs text-xs">
                                          {servicoLabel}
                                        </TooltipContent>
                                      )}
                                    </Tooltip>
                                  </TooltipProvider>

                                  <Separator className="my-2" />

                                  <div className="flex flex-col gap-1">
                                    {servico.realizadores.length > 0 ? (
                                      servico.realizadores.map((r) => (
                                        <div key={r.id} className="flex items-center gap-1.5">
                                          <UserRound className="h-3 w-3 text-muted-foreground shrink-0" />
                                          <span className="text-xs text-muted-foreground">{r.nome ?? "-"}</span>
                                        </div>
                                      ))
                                    ) : (
                                      <span className="text-xs text-muted-foreground italic">
                                        Aguardando realizador
                                      </span>
                                    )}

                                    {minha?.iniciadoEm && (
                                      <div className="flex items-center gap-1 text-xs font-mono text-primary">
                                        <Clock className="h-3 w-3" />
                                        {minha.statusExecucao === "EM_EXECUCAO"
                                          ? formatTimeDiff(minha.iniciadoEm, now)
                                          : "Concluído"}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div className="shrink-0">
                                  {minha?.statusExecucao === "EM_EXECUCAO" && (
                                    <Button
                                      size="icon"
                                      className="h-9 w-9 rounded-full bg-green-600 hover:bg-green-700"
                                      onClick={() => setFinalizarTarget({ ordem, servico })}
                                      disabled={isBusy || tab !== "ativas"}
                                    >
                                      {isBusy ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <CheckCircle2 className="h-4 w-4" />
                                      )}
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Lista de Produtos */}
                  {ordem.produtos.length > 0 && (
                    <div className="p-4 bg-secondary/20 border-t-2 border-border/50">
                      <h4 className="text-sm font-bold uppercase text-foreground/70 tracking-widest mb-3 flex items-center gap-2">
                        📦 Produtos Necessários
                      </h4>
                      <div className="grid grid-cols-1 gap-2">
                        {ordem.produtos.map((p) => (
                          <div
                            key={p.id}
                            className="flex items-center justify-between bg-card p-3 rounded-lg border-2 border-border/50 shadow-sm"
                          >
                            <span className="text-base font-bold text-foreground">{p.titulo}</span>
                            <Badge variant="secondary" className="text-sm font-black px-3 py-1 bg-muted-foreground/10">
                              x{p.quantidade}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={!!assumirTarget}
        onOpenChange={(open) => {
          if (busyKey?.endsWith(":bulk-iniciar")) return;
          if (!open) {
            setAssumirTarget(null);
            setServicosSelecionados([]);
            setBuscaServico("");
          }
        }}
      >
        <DialogContent className="w-[calc(100vw-2rem)] max-h-[85vh] max-w-[100dvw] p-0 overflow-hidden sm:max-w-2xl sm:max-h-[700px] sm:w-[95vw] flex flex-col rounded-xl">
          <div className="flex h-full min-h-0 flex-col">
            <DialogHeader className="shrink-0 border-b px-4 py-3 sm:px-6">
              <DialogTitle className="text-sm sm:text-lg">
                Execução de Itens
                <span className="ml-1 text-xs font-light text-muted-foreground sm:text-sm">
                  | OS #{assumirTarget?.ordem.id}
                </span>
              </DialogTitle>
            </DialogHeader>

            <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-4 sm:p-6 gap-4">
              <div className="flex items-center justify-between gap-2 shrink-0">
                <p className="text-sm text-muted-foreground">Selecione os serviços que você vai realizar.</p>
                <Badge variant="secondary">{servicosSelecionados.length} selecionados</Badge>
              </div>

              <div className="flex gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => setServicosSelecionados(servicosAssumiveis.map((s) => s.servicoid))}
                  disabled={servicosAssumiveis.length === 0}
                >
                  Marcar Todos
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => setServicosSelecionados([])}
                  disabled={servicosSelecionados.length === 0}
                >
                  Limpar
                </Button>
              </div>

              <ScrollArea className="flex-1 border rounded-lg">
                <div className="space-y-2 p-3">
                  {servicosAssumiveis.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">Nenhum serviço disponível.</div>
                  ) : (
                    servicosAssumiveis.map((servico) => (
                      <ServicoItem
                        key={servico.servicoid}
                        servico={servico}
                        checked={servicosSelecionados.includes(servico.servicoid)}
                        onToggle={toggleServicoSelecionado}
                      />
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            <DialogFooter className="shrink-0 border-t px-4 py-3 sm:px-6">
              <div className="flex w-full gap-2">
                <Button
                  variant="outline"
                  className="flex-1 hover:cursor-pointer"
                  onClick={() => {
                    setAssumirTarget(null);
                    setServicosSelecionados([]);
                    setBuscaServico("");
                  }}
                  disabled={busyKey?.endsWith(":bulk-iniciar")}
                >
                  Cancelar
                </Button>
                <Button
                  className="flex-1 hover:cursor-pointer"
                  onClick={iniciarServicosSelecionados}
                  disabled={servicosSelecionados.length === 0 || busyKey === `${assumirTarget?.ordem.id}:bulk-iniciar`}
                >
                  {busyKey === `${assumirTarget?.ordem.id}:bulk-iniciar` ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  Iniciar Selecionados
                </Button>
              </div>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!estoqueDialog} onOpenChange={(open) => !open && setEstoqueDialog(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Estoque insuficiente para iniciar a OS</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                A OS <b>#{estoqueDialog?.osId}</b> não pode ser iniciada porque existem produtos do orçamento sem
                estoque suficiente.
              </p>
              {estoqueDialog?.message ? <p>{estoqueDialog.message}</p> : null}
            </div>

            <div className="max-h-72 overflow-y-auto rounded-md border">
              <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem]">
                <span>Produto</span>
                <span className="text-right">Disponível</span>
                <span className="text-right">Necessário</span>
              </div>
              {(estoqueDialog?.itens ?? []).map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] gap-3 border-b px-3 py-2 text-sm last:border-b-0 sm:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem]"
                >
                  <span className="min-w-0 truncate font-medium">{item.titulo}</span>
                  <span className="text-right tabular-nums text-muted-foreground">{item.disponivel}</span>
                  <span className="text-right tabular-nums font-semibold">{item.solicitado}</span>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setEstoqueDialog(null)}>Entendi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!finalizarTarget}
        onOpenChange={(open) => {
          if (!open) {
            setFinalizarTarget(null);
            setObservacao("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Finalizar minha parte</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <p className="font-medium">OS #{finalizarTarget?.ordem.id}</p>
              <p className="text-muted-foreground">{finalizarTarget?.servico.descricao}</p>
            </div>

            <Separator />

            <Textarea
              value={observacao}
              onChange={(event) => setObservacao(event.target.value)}
              placeholder="Observacao opcional sobre a execucao"
              className="min-h-24 text-sm"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setFinalizarTarget(null);
                setObservacao("");
              }}
            >
              Cancelar
            </Button>
            <Button onClick={confirmarFinalizacao} disabled={!finalizarTarget || !!busyKey}>
              {busyKey ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Finalizar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
