"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  AlertCircle,
  Calendar as CalendarIcon,
  Check,
  FileText,
  ListTodo,
  MoreVertical,
  Pin,
  Pencil,
  Trash2,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TarefaUsuario } from "../types";

function parseYYYYMMDDToDate(v?: string | null) {
  if (!v) return undefined;
  const s = String(v).includes("T") ? String(v).slice(0, 10) : String(v);
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

function formatDateToYYYYMMDD(d?: Date) {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatCreatedDate(isoString?: string | null) {
  if (!isoString) return null;
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return null;
    const dia = String(d.getDate()).padStart(2, "0");
    const mes = String(d.getMonth() + 1).padStart(2, "0");
    const ano = d.getFullYear();
    return `${dia}/${mes}/${ano}`;
  } catch {
    return null;
  }
}

interface TaskItemCardProps {
  tarefa: TarefaUsuario;
  clientDate: string; // YYYY-MM-DD
  onToggleStatus: (tarefa: TarefaUsuario) => void;
  onTogglePin: (tarefa: TarefaUsuario) => void;
  onSelect: (tarefa: TarefaUsuario) => void;
  onDelete: (tarefa: TarefaUsuario) => void;
  onConvertType: (tarefa: TarefaUsuario) => void;
  onUpdateDate?: (tarefa: TarefaUsuario, newDate: string | null) => void;
  isPendingCompletion?: boolean;
}

export function TaskItemCard({
  tarefa,
  clientDate,
  onToggleStatus,
  onTogglePin,
  onSelect,
  onDelete,
  onConvertType,
  onUpdateDate,
  isPendingCompletion = false,
}: TaskItemCardProps) {
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const isCompleted = tarefa.status === "CONCLUIDA" || isPendingCompletion;
  const isNota = tarefa.tipo === "NOTA";

  // Formatação e cálculo de vencimento da data prevista (igual para tarefas e anotações)
  const dateInfo = useMemo(() => {
    if (!tarefa.data_prevista) return null;
    const parts = tarefa.data_prevista.split("-");
    if (parts.length !== 3) return null;
    const [ano, mes, dia] = parts;
    const formatted = `${dia}/${mes}/${ano}`;

    const isOverdue =
      !isCompleted && tarefa.data_prevista < clientDate;
    const isToday = tarefa.data_prevista === clientDate;

    return {
      formatted,
      isOverdue,
      isToday,
    };
  }, [tarefa.data_prevista, clientDate, isCompleted]);

  // Data de criação em formato DD/MM/AAAA
  const createdDateFormatted = useMemo(() => {
    return formatCreatedDate(tarefa.created_at);
  }, [tarefa.created_at]);

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 8, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
      whileHover={{ y: -1 }}
      onClick={() => onSelect(tarefa)}
      className={`group relative flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-3.5 transition-colors hover:border-foreground/25 hover:shadow-xs sm:gap-3.5 sm:p-4 ${
        tarefa.fixada ? "border-primary/30 bg-primary/2" : ""
      } ${isCompleted ? "opacity-65" : ""}`}
    >
      {/* Marcador ou Checkbox */}
      <div
        className="mt-0.5 shrink-0"
        onClick={(e) => e.stopPropagation()} // Impede abrir o Sheet ao clicar no checkbox
      >
        {isNota ? (
          <div className="flex size-5 items-center justify-center rounded-md bg-muted text-muted-foreground ring-1 ring-border">
            <FileText className="size-3" aria-hidden="true" />
          </div>
        ) : (
          <Checkbox
            checked={isCompleted}
            onCheckedChange={() => onToggleStatus(tarefa)}
            aria-label={`Concluir tarefa: ${tarefa.titulo}`}
            className="size-5 rounded-md"
          />
        )}
      </div>

      {/* Conteúdo principal */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p
            className={`text-sm font-medium leading-snug transition-all ${
              isCompleted
                ? "text-muted-foreground line-through decoration-muted-foreground/60"
                : "text-foreground"
            }`}
          >
            {tarefa.titulo}
          </p>

          {/* Botão de Fixar sutil no desktop */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(tarefa);
            }}
            title={tarefa.fixada ? "Desafixar item" : "Fixar no topo"}
            className={`hidden shrink-0 rounded-md p-1 transition-colors group-hover:block sm:inline-flex ${
              tarefa.fixada
                ? "text-primary hover:text-primary/80"
                : "text-muted-foreground/40 hover:text-muted-foreground"
            }`}
          >
            <Pin
              className={`size-3.5 ${tarefa.fixada ? "fill-primary" : ""}`}
              aria-hidden="true"
            />
          </button>
        </div>

        {tarefa.descricao && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {tarefa.descricao}
          </p>
        )}

        {/* Metadados, Badges e Data de Criação */}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            {(dateInfo || !isNota) && (
              <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                <PopoverTrigger asChild>
                  {dateInfo ? (
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      title="Alterar data prevista"
                      className="group/date inline-flex cursor-pointer transition-transform hover:scale-[1.03] focus:outline-none"
                    >
                      <Badge
                        variant="outline"
                        className={`gap-1 text-[11px] font-normal transition-colors group-hover/date:border-primary/50 ${
                          dateInfo.isOverdue
                            ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            : dateInfo.isToday
                              ? "border-primary/30 bg-primary/10 text-primary"
                              : "text-muted-foreground"
                        }`}
                      >
                        {dateInfo.isOverdue ? (
                          <AlertCircle className="size-3 shrink-0" aria-hidden="true" />
                        ) : (
                          <CalendarIcon className="size-3 shrink-0" aria-hidden="true" />
                        )}
                        <span>
                          {dateInfo.isToday ? "Hoje" : dateInfo.formatted}
                          {dateInfo.isOverdue ? " (Atrasada)" : ""}
                        </span>
                      </Badge>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      title="Definir data prevista"
                      className="inline-flex cursor-pointer opacity-70 transition-opacity hover:opacity-100 focus:outline-none"
                    >
                      <Badge
                        variant="outline"
                        className="gap-1 border-dashed text-[11px] font-normal text-muted-foreground hover:border-solid hover:border-primary/50"
                      >
                        <CalendarIcon className="size-3 shrink-0" aria-hidden="true" />
                        <span>+ Data</span>
                      </Badge>
                    </button>
                  )}
                </PopoverTrigger>

                <PopoverContent
                  className="w-auto p-0"
                  align="start"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between border-b px-3 py-2 text-xs">
                    <span className="font-medium text-muted-foreground">Data prevista</span>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateDate?.(tarefa, clientDate);
                          setIsCalendarOpen(false);
                        }}
                      >
                        Hoje
                      </Button>
                      {tarefa.data_prevista && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateDate?.(tarefa, null);
                            setIsCalendarOpen(false);
                          }}
                        >
                          Sem data
                        </Button>
                      )}
                    </div>
                  </div>
                  <Calendar
                    mode="single"
                    selected={parseYYYYMMDDToDate(tarefa.data_prevista)}
                    onSelect={(date) => {
                      if (!date) return;
                      onUpdateDate?.(tarefa, formatDateToYYYYMMDD(date));
                      setIsCalendarOpen(false);
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            )}

            {tarefa.prioridade === "ALTA" && !isCompleted && (
              <Badge
                variant="outline"
                className="border-red-500/30 bg-red-500/10 text-[11px] font-normal text-red-600 dark:text-red-400"
              >
                Prioridade Alta
              </Badge>
            )}

            {tarefa.prioridade === "BAIXA" && !isCompleted && (
              <Badge
                variant="outline"
                className="text-[11px] font-normal text-muted-foreground/80"
              >
                Baixa
              </Badge>
            )}

            {tarefa.completed_at && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Check className="size-3" aria-hidden="true" />
                Concluída
              </span>
            )}
          </div>

          {createdDateFormatted && (
            <span
              className="ml-auto text-[11px] text-muted-foreground/60 select-none tabular-nums"
              title={`Criado em ${createdDateFormatted}`}
            >
              Criado em {createdDateFormatted}
            </span>
          )}
        </div>
      </div>

      {/* Menu de ações do card */}
      <div
        className="shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
            >
              <MoreVertical className="size-3.5" />
              <span className="sr-only">Opções da tarefa</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => onSelect(tarefa)}>
              <Pencil className="size-3.5" />
              Ver detalhes / Editar
            </DropdownMenuItem>

            <DropdownMenuItem onClick={() => onTogglePin(tarefa)}>
              <Pin className="size-3.5" />
              {tarefa.fixada ? "Desafixar" : "Fixar no topo"}
            </DropdownMenuItem>

            <DropdownMenuItem onClick={() => onConvertType(tarefa)}>
              {isNota ? (
                <>
                  <ListTodo className="size-3.5" />
                  Transformar em Tarefa
                </>
              ) : (
                <>
                  <FileText className="size-3.5" />
                  Transformar em Anotação
                </>
              )}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={() => onDelete(tarefa)}
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              <Trash2 className="size-3.5" />
              Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.div>
  );
}
