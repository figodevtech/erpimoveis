"use client";

import {
  CalendarDays,
  CheckCircle2,
  FileText,
  ListTodo,
  Pin,
  SearchX,
  SunMedium,
} from "lucide-react";
import type { TarefasViewFilter, TarefaTipo } from "../types";

interface TaskEmptyStateProps {
  view: TarefasViewFilter;
  tipo?: TarefaTipo;
  isSearching?: boolean;
}

export function TaskEmptyState({ view, tipo, isSearching }: TaskEmptyStateProps) {
  if (isSearching) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/20 px-6 py-14 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-xs">
          <SearchX className="size-6" aria-hidden="true" />
        </div>
        <h3 className="mt-4 text-base font-medium">Nenhum resultado encontrado</h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Tente buscar com outras palavras-chave ou confira se o filtro selecionado é o correto.
        </p>
      </div>
    );
  }

  const emptyConfig: Record<
    TarefasViewFilter,
    { icon: React.ElementType; title: string; desc: string }
  > = {
    hoje: {
      icon: SunMedium,
      title: "Nenhuma tarefa para hoje",
      desc: "Aproveite para relaxar ou organizar as próximas atividades da semana.",
    },
    proximas: {
      icon: CalendarDays,
      title: "Nenhuma tarefa futura programada",
      desc: "Adicione datas previstas às suas tarefas para acompanhar seus prazos aqui.",
    },
    todas: {
      icon: tipo === "NOTA" ? FileText : ListTodo,
      title: tipo === "NOTA" ? "Nenhuma anotação registrada" : "Tudo em dia!",
      desc:
        tipo === "NOTA"
          ? "Use este espaço para anotações soltas, ideias ou instruções rápidas."
          : "Você não possui nenhuma tarefa aberta no momento. Crie um novo lembrete acima.",
    },
    notas: {
      icon: FileText,
      title: "Nenhuma anotação registrada",
      desc: "Use este espaço para anotações soltas, números de telefone ou instruções que precisa ter à mão.",
    },
    concluidas: {
      icon: CheckCircle2,
      title: "Histórico de conclusões vazio",
      desc: "Quando você concluir uma tarefa, ela será arquivada aqui para consulta futura.",
    },
    favoritas: {
      icon: Pin,
      title: tipo === "NOTA" ? "Nenhuma anotação fixada" : "Nenhum item fixado",
      desc:
        tipo === "NOTA"
          ? "Fixe anotações importantes para deixá-las sempre com acesso rápido no topo."
          : "Fixe tarefas importantes para deixá-las sempre com acesso rápido.",
    },
  };

  const current = emptyConfig[view] || emptyConfig.todas;
  const Icon = current.icon;

  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/15 px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-xs ring-1 ring-primary/15">
        <Icon className="size-6" aria-hidden="true" />
      </div>
      <h3 className="mt-4 text-base font-semibold tracking-tight">{current.title}</h3>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {current.desc}
      </p>
    </div>
  );
}
