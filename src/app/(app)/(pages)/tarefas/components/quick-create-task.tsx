"use client";

import { useState } from "react";
import { FileText, ListTodo, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TarefaTipo } from "../types";

interface QuickCreateTaskProps {
  onCreate: (payload: {
    titulo: string;
    tipo: TarefaTipo;
    data_prevista?: string | null;
  }) => Promise<void>;
  isCreating: boolean;
  defaultDate?: string | null;
  defaultTipo?: TarefaTipo;
}

export function QuickCreateTask({
  onCreate,
  isCreating,
  defaultDate = null,
  defaultTipo = "TAREFA",
}: QuickCreateTaskProps) {
  const [titulo, setTitulo] = useState("");
  const isTarefa = defaultTipo === "TAREFA";

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const clean = titulo.trim();
    if (!clean || isCreating) return;

    try {
      await onCreate({
        titulo: clean,
        tipo: defaultTipo,
        data_prevista:
          defaultTipo === "TAREFA"
            ? defaultDate || new Date().toISOString().slice(0, 10)
            : null,
      });
      setTitulo("");
    } catch {
      // O toast de erro é disparado pelo hook mutation
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="relative rounded-2xl border bg-card p-2 shadow-xs transition-shadow focus-within:border-ring focus-within:ring-1 focus-within:ring-ring sm:p-2.5"
    >
      <div className="flex items-center gap-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
          {isTarefa ? (
            <ListTodo className="size-4" aria-hidden="true" />
          ) : (
            <FileText className="size-4" aria-hidden="true" />
          )}
        </div>

        <Input
          type="text"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder={
            isTarefa
              ? "O que você precisa lembrar ou fazer? (pressione Enter para salvar)"
              : "Digite uma anotação rápida e pressione Enter para salvar..."
          }
          disabled={isCreating}
          className="h-10 flex-1 border-0 bg-transparent px-2 text-sm shadow-none focus-visible:ring-0"
          autoComplete="off"
        />

        <Button
          type="submit"
          size="sm"
          disabled={!titulo.trim() || isCreating}
          className="shrink-0 gap-1.5"
        >
          {isCreating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          <span className="hidden sm:inline">Adicionar</span>
        </Button>
      </div>
    </form>
  );
}
