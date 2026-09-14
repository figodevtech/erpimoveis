"use client";

import { useMemo, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  CalendarDays,
  CheckCircle2,
  FileText,
  ListTodo,
  Pin,
  Search,
  SunMedium,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "@/lib/toast";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  MainTabType,
  NoteSubFilter,
  TaskSubFilter,
  TarefasViewFilter,
  TarefaTipo,
  TarefaUsuario,
} from "./types";
import { QuickCreateTask } from "./components/quick-create-task";
import { TaskItemCard } from "./components/task-item-card";
import { TaskDetailSheet } from "./components/task-detail-sheet";
import { TaskEmptyState } from "./components/task-empty-state";

// Criação do QueryClient isolado para o módulo de tarefas
function createTarefasQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        staleTime: 1000 * 60 * 2, // 2 minutos de frescor no cache
        retry: 1,
      },
    },
  });
}

function TarefasContent() {
  const queryClient = useQueryClient();

  const [mainTab, setMainTab] = useState<MainTabType>("TAREFAS");
  const [taskFilter, setTaskFilter] = useState<TaskSubFilter>("hoje");
  const [noteFilter, setNoteFilter] = useState<NoteSubFilter>("todas");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTask, setSelectedTask] = useState<TarefaUsuario | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [pendingCompletions, setPendingCompletions] = useState<Set<string>>(
    new Set()
  );

  // Data local do navegador (AAAA-MM-DD)
  const clientToday = useMemo(() => {
    const d = new Date();
    const ano = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, "0");
    const dia = String(d.getDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
  }, []);

  const effectiveView: TarefasViewFilter =
    mainTab === "TAREFAS"
      ? taskFilter
      : noteFilter === "favoritas"
        ? "favoritas"
        : "notas";

  // Busca de tarefas/anotações de acordo com a tab principal e o filtro ativo
  const { data, isLoading, isError } = useQuery<{ tarefas: TarefaUsuario[] }>({
    queryKey: [
      "tarefas",
      mainTab,
      mainTab === "TAREFAS" ? taskFilter : noteFilter,
      clientToday,
      searchQuery,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("tipo", mainTab === "TAREFAS" ? "TAREFA" : "NOTA");
      params.set("view", effectiveView);
      params.set("ref", clientToday);
      if (searchQuery.trim()) {
        params.set("q", searchQuery.trim());
      }

      const res = await fetch(`/api/tarefas?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Falha ao carregar itens.");
      }
      return res.json();
    },
  });

  const tarefas = data?.tarefas ?? [];

  // Mutação: Criação rápida
  const createMutation = useMutation({
    mutationFn: async (payload: {
      titulo: string;
      tipo: TarefaTipo;
      data_prevista?: string | null;
    }) => {
      const res = await fetch("/api/tarefas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Não foi possível criar a tarefa.");
      }
      return res.json();
    },
    onSuccess: (resp) => {
      toast.success(
        resp.tarefa?.tipo === "NOTA"
          ? "Anotação salva com sucesso."
          : "Tarefa criada com sucesso."
      );
      void queryClient.invalidateQueries({ queryKey: ["tarefas"] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Erro ao salvar item.");
    },
  });

  // Mutação: Atualização completa (via Sheet)
  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<TarefaUsuario>;
    }) => {
      const res = await fetch(`/api/tarefas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Não foi possível atualizar a tarefa.");
      }
      return res.json();
    },
    onSuccess: (resp) => {
      toast.success("Alterações salvas.");
      setSelectedTask(resp.tarefa);
      void queryClient.invalidateQueries({ queryKey: ["tarefas"] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Erro ao atualizar.");
    },
  });

  // Mutação: Alternar Conclusão (com delay suave e Toast com Desfazer)
  const toggleStatusMutation = useMutation({
    mutationFn: async ({
      id,
      nextStatus,
    }: {
      id: string;
      nextStatus: "ABERTA" | "CONCLUIDA";
    }) => {
      const res = await fetch(`/api/tarefas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        throw new Error("Não foi possível alterar a situação da tarefa.");
      }
      return res.json();
    },
    onError: (err: any) => {
      toast.error(err.message || "Falha na atualização de status.");
      void queryClient.invalidateQueries({ queryKey: ["tarefas"] });
    },
  });

  // Handler para checkbox de conclusão
  const handleToggleStatus = (tarefa: TarefaUsuario) => {
    const isCompleted = tarefa.status === "CONCLUIDA";
    const nextStatus = isCompleted ? "ABERTA" : "CONCLUIDA";

    if (!isCompleted) {
      // Marcando como concluída: aplica strikethrough imediato
      setPendingCompletions((prev) => new Set(prev).add(tarefa.id));

      toggleStatusMutation.mutate(
        { id: tarefa.id, nextStatus },
        {
          onSuccess: () => {
            toast.success("Tarefa concluída!", {
              action: {
                label: "Desfazer",
                onClick: () => {
                  setPendingCompletions((prev) => {
                    const next = new Set(prev);
                    next.delete(tarefa.id);
                    return next;
                  });
                  toggleStatusMutation.mutate(
                    { id: tarefa.id, nextStatus: "ABERTA" },
                    {
                      onSuccess: () => {
                        toast.info("Tarefa reaberta.");
                        void queryClient.invalidateQueries({
                          queryKey: ["tarefas"],
                        });
                      },
                    }
                  );
                },
              },
            });

            // Remove suavemente após 1.2 segundos da tela aberta
            setTimeout(() => {
              setPendingCompletions((prev) => {
                const next = new Set(prev);
                next.delete(tarefa.id);
                return next;
              });
              void queryClient.invalidateQueries({ queryKey: ["tarefas"] });
            }, 1200);
          },
        }
      );
    } else {
      // Reabrindo tarefa concluída
      toggleStatusMutation.mutate(
        { id: tarefa.id, nextStatus: "ABERTA" },
        {
          onSuccess: () => {
            toast.success("Tarefa reaberta.");
            void queryClient.invalidateQueries({ queryKey: ["tarefas"] });
          },
        }
      );
    }
  };

  // Mutação: Alternar Fixada / Favorita
  const togglePinMutation = useMutation({
    mutationFn: async ({ id, fixada }: { id: string; fixada: boolean }) => {
      const res = await fetch(`/api/tarefas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixada }),
      });
      if (!res.ok) throw new Error("Erro ao alterar fixação.");
      return res.json();
    },
    onSuccess: (resp) => {
      toast.success(
        resp.tarefa?.fixada ? "Item fixado no topo." : "Item desafixado."
      );
      void queryClient.invalidateQueries({ queryKey: ["tarefas"] });
    },
    onError: () => toast.error("Falha ao fixar item."),
  });

  // Mutação: Converter Tipo (Tarefa <-> Nota)
  const convertTypeMutation = useMutation({
    mutationFn: async (tarefa: TarefaUsuario) => {
      const nextTipo = tarefa.tipo === "TAREFA" ? "NOTA" : "TAREFA";
      const res = await fetch(`/api/tarefas/${tarefa.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: nextTipo,
          status: "ABERTA",
        }),
      });
      if (!res.ok) throw new Error("Erro ao converter item.");
      return res.json();
    },
    onSuccess: (resp) => {
      toast.success(
        resp.tarefa?.tipo === "NOTA"
          ? "Item transformado em Anotação."
          : "Item transformado em Tarefa."
      );
      void queryClient.invalidateQueries({ queryKey: ["tarefas"] });
    },
    onError: () => toast.error("Falha ao converter item."),
  });

  // Mutação: Exclusão
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/tarefas/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Erro ao excluir.");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Item excluído com sucesso.");
      void queryClient.invalidateQueries({ queryKey: ["tarefas"] });
    },
    onError: () => toast.error("Não foi possível excluir o item."),
  });

  const handleOpenDetail = (tarefa: TarefaUsuario) => {
    setSelectedTask(tarefa);
    setIsSheetOpen(true);
  };

  const taskFilterTabs: Array<{
    id: TaskSubFilter;
    label: string;
    icon: React.ElementType;
  }> = [
    { id: "hoje", label: "Hoje", icon: SunMedium },
    { id: "proximas", label: "Próximas", icon: CalendarDays },
    { id: "todas", label: "Todas", icon: ListTodo },
    { id: "concluidas", label: "Concluídas", icon: CheckCircle2 },
    { id: "favoritas", label: "Fixadas", icon: Pin },
  ];

  const noteFilterTabs: Array<{
    id: NoteSubFilter;
    label: string;
    icon: React.ElementType;
  }> = [
    { id: "todas", label: "Todas as Anotações", icon: FileText },
    { id: "favoritas", label: "Fixadas", icon: Pin },
  ];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 pb-12">
      {/* Cabeçalho e Tabs Principais: Tarefas vs Anotações */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tarefas & Anotações</h1>
          <p className="text-sm text-muted-foreground">
            Organize suas atividades, lembretes e anotações pessoais no ERP.
          </p>
        </div>

        {/* As duas tabs principais com indicador deslizante animado */}
        <div className="relative flex rounded-xl bg-muted/60 p-1 border shadow-xs">
          <button
            type="button"
            onClick={() => {
              setMainTab("TAREFAS");
              setSearchQuery("");
            }}
            className={`relative flex items-center gap-2 rounded-lg px-4 py-1.5 text-xs sm:text-sm font-medium transition-colors ${
              mainTab === "TAREFAS"
                ? "text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {mainTab === "TAREFAS" && (
              <motion.span
                layoutId="main-tab-indicator"
                className="absolute inset-0 rounded-lg bg-background shadow-xs pointer-events-none"
                transition={{ type: "spring", stiffness: 450, damping: 35 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              <ListTodo className="size-4" />
              <span>Tarefas</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMainTab("NOTAS");
              setSearchQuery("");
            }}
            className={`relative flex items-center gap-2 rounded-lg px-4 py-1.5 text-xs sm:text-sm font-medium transition-colors ${
              mainTab === "NOTAS"
                ? "text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {mainTab === "NOTAS" && (
              <motion.span
                layoutId="main-tab-indicator"
                className="absolute inset-0 rounded-lg bg-background shadow-xs pointer-events-none"
                transition={{ type: "spring", stiffness: 450, damping: 35 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              <FileText className="size-4" />
              <span>Anotações</span>
            </span>
          </button>
        </div>
      </div>

      {/* Transição animada de conteúdo entre Tarefas e Anotações */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={mainTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: "easeInOut" }}
          className="flex flex-col gap-6"
        >
          {/* Caixa de Criação Rápida */}
          <QuickCreateTask
            key={mainTab}
            onCreate={async (payload) => {
              await createMutation.mutateAsync(payload);
            }}
            isCreating={createMutation.isPending}
            defaultDate={clientToday}
            defaultTipo={mainTab === "TAREFAS" ? "TAREFA" : "NOTA"}
          />

          {/* Barra de Filtros Internos (Tabs/Badges) e Busca */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Filtros em Badges/Pills conforme a aba selecionada */}
            {mainTab === "TAREFAS" ? (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                {taskFilterTabs.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = taskFilter === tab.id;
                  return (
                    <motion.button
                      key={tab.id}
                      type="button"
                      onClick={() => setTaskFilter(tab.id)}
                      whileTap={{ scale: 0.96 }}
                      className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                        isActive
                          ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                          : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground border border-border/40"
                      }`}
                    >
                      <Icon className="size-3.5" aria-hidden="true" />
                      <span>{tab.label}</span>
                    </motion.button>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                {noteFilterTabs.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = noteFilter === tab.id;
                  return (
                    <motion.button
                      key={tab.id}
                      type="button"
                      onClick={() => setNoteFilter(tab.id)}
                      whileTap={{ scale: 0.96 }}
                      className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                        isActive
                          ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                          : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground border border-border/40"
                      }`}
                    >
                      <Icon className="size-3.5" aria-hidden="true" />
                      <span>{tab.label}</span>
                    </motion.button>
                  );
                })}
              </div>
            )}

            {/* Input de Busca */}
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  mainTab === "TAREFAS"
                    ? "Buscar em tarefas..."
                    : "Buscar em anotações..."
                }
                className="h-9 w-full rounded-xl pl-8 pr-8 text-xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Lista de Tarefas / Anotações */}
          <div className="space-y-2.5">
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
              </div>
            ) : isError ? (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-center text-sm text-destructive">
                Não foi possível carregar os itens no momento. Tente novamente mais tarde.
              </div>
            ) : tarefas.length === 0 ? (
              <TaskEmptyState
                view={effectiveView}
                tipo={mainTab === "TAREFAS" ? "TAREFA" : "NOTA"}
                isSearching={Boolean(searchQuery.trim())}
              />
            ) : (
              <AnimatePresence mode="popLayout" initial={false}>
                {tarefas.map((tarefa) => (
                  <TaskItemCard
                    key={tarefa.id}
                    tarefa={tarefa}
                    clientDate={clientToday}
                    onToggleStatus={handleToggleStatus}
                    onTogglePin={(t) =>
                      togglePinMutation.mutate({ id: t.id, fixada: !t.fixada })
                    }
                    onSelect={handleOpenDetail}
                    onDelete={(t) => deleteMutation.mutate(t.id)}
                    onConvertType={(t) => convertTypeMutation.mutate(t)}
                    onUpdateDate={(t, newDate) =>
                      updateMutation.mutate({
                        id: t.id,
                        updates: { data_prevista: newDate },
                      })
                    }
                    isPendingCompletion={pendingCompletions.has(tarefa.id)}
                  />
                ))}
              </AnimatePresence>
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Painel Lateral Sheet para Visualização / Edição de Detalhes */}
      <TaskDetailSheet
        tarefa={selectedTask}
        isOpen={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
        onSave={async (id, updates) => {
          await updateMutation.mutateAsync({ id, updates });
          setIsSheetOpen(false);
        }}
        onDelete={async (id) => {
          await deleteMutation.mutateAsync(id);
          setIsSheetOpen(false);
        }}
        isSaving={updateMutation.isPending}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}

export function TarefasClient() {
  const [queryClient] = useState(() => createTarefasQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <TarefasContent />
    </QueryClientProvider>
  );
}
