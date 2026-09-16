"use client";

import { useState } from "react";
import {
  Calendar as CalendarIcon,
  Check,
  Clock,
  Loader2,
  Save,
  Trash2,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type {
  TarefaPrioridade,
  TarefaStatus,
  TarefaTipo,
  TarefaUsuario,
} from "../types";

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

function formatDisplayDate(val?: string | null) {
  if (!val) return "";
  const parts = val.split("-");
  if (parts.length !== 3) return val;
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
}

interface TaskDetailSheetProps {
  tarefa: TarefaUsuario | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    id: string,
    updates: Partial<TarefaUsuario>,
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  isSaving: boolean;
  isDeleting: boolean;
}

interface TaskFormContentProps {
  tarefa: TarefaUsuario;
  onClose: () => void;
  onSave: (
    id: string,
    updates: Partial<TarefaUsuario>,
  ) => Promise<void>;
  onOpenDelete: () => void;
  isSaving: boolean;
  isDeleting: boolean;
}

function TaskFormContent({
  tarefa,
  onClose,
  onSave,
  onOpenDelete,
  isSaving,
  isDeleting,
}: TaskFormContentProps) {
  const [titulo, setTitulo] = useState(tarefa.titulo || "");
  const [descricao, setDescricao] = useState(tarefa.descricao || "");
  const [tipo, setTipo] = useState<TarefaTipo>(tarefa.tipo);
  const [status, setStatus] = useState<TarefaStatus>(tarefa.status);
  const [prioridade, setPrioridade] = useState<TarefaPrioridade>(tarefa.prioridade);
  const [dataPrevista, setDataPrevista] = useState(tarefa.data_prevista || "");
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [fixada, setFixada] = useState(Boolean(tarefa.fixada));

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo.trim() || isSaving) return;

    await onSave(tarefa.id, {
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      tipo,
      status,
      prioridade,
      data_prevista: dataPrevista || null,
      fixada,
    });
  }

  const formatDateTime = (isoString?: string | null) => {
    if (!isoString) return null;
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return null;
    }
  };

  return (
    <form
      onSubmit={handleFormSubmit}
      className="flex h-full flex-col justify-between overflow-hidden"
    >
      <SheetHeader className="border-b px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {tipo === "TAREFA" ? "Tarefa pessoal" : "Anotação privada"}
          </span>
        </div>
        <SheetTitle className="text-lg">
          {tipo === "TAREFA" ? "Detalhes da Tarefa" : "Detalhes da Anotação"}
        </SheetTitle>
        <SheetDescription className="text-xs">
          Atualize as informações do seu item pessoal.
        </SheetDescription>
      </SheetHeader>

      {/* Conteúdo scrollável com campos */}
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {/* Título */}
        <div className="space-y-1.5">
          <Label htmlFor="tarefa-titulo">Título *</Label>
          <Input
            id="tarefa-titulo"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex: Ligar para fornecedor..."
            required
            maxLength={255}
          />
        </div>

        {/* Descrição */}
        <div className="space-y-1.5">
          <Label htmlFor="tarefa-descricao">Anotações / Descrição</Label>
          <Textarea
            id="tarefa-descricao"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Detalhes adicionais, números de OS, links ou observações..."
            rows={4}
            className="resize-y"
            maxLength={4000}
          />
        </div>

        {/* Tipo e Prioridade */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select
              value={tipo}
              onValueChange={(val: TarefaTipo) => setTipo(val)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TAREFA">Tarefa</SelectItem>
                <SelectItem value="NOTA">Anotação</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Prioridade</Label>
            <Select
              value={prioridade}
              onValueChange={(val: TarefaPrioridade) => setPrioridade(val)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Prioridade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BAIXA">Baixa</SelectItem>
                <SelectItem value="NORMAL">Normal</SelectItem>
                <SelectItem value="ALTA">Alta</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Status (apenas para tipo TAREFA) */}
        {tipo === "TAREFA" && (
          <div className="space-y-1.5">
            <Label>Situação</Label>
            <Select
              value={status}
              onValueChange={(val: TarefaStatus) => setStatus(val)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Situação" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ABERTA">Aberta / Pendente</SelectItem>
                <SelectItem value="CONCLUIDA">Concluída</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Data Prevista com Shadcn DatePicker */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="tarefa-data-prevista" className="flex items-center gap-1.5">
              <CalendarIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
              Data prevista
            </Label>
            {dataPrevista && (
              <button
                type="button"
                onClick={() => setDataPrevista("")}
                className="text-xs text-muted-foreground transition-colors hover:text-destructive"
              >
                Limpar data
              </button>
            )}
          </div>
          <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
            <PopoverTrigger asChild>
              <Button
                id="tarefa-data-prevista"
                type="button"
                variant="outline"
                className={`w-full justify-start text-left font-normal ${
                  !dataPrevista ? "text-muted-foreground" : ""
                }`}
              >
                <CalendarIcon className="mr-2 size-4" />
                {dataPrevista
                  ? formatDisplayDate(dataPrevista)
                  : "Selecione uma data prevista"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <div className="flex items-center justify-between border-b px-3 py-2 text-xs">
                <span className="font-medium text-muted-foreground">Calendário</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    const today = new Date();
                    const y = today.getFullYear();
                    const m = String(today.getMonth() + 1).padStart(2, "0");
                    const d = String(today.getDate()).padStart(2, "0");
                    setDataPrevista(`${y}-${m}-${d}`);
                    setIsCalendarOpen(false);
                  }}
                >
                  Hoje
                </Button>
              </div>
              <Calendar
                mode="single"
                selected={parseYYYYMMDDToDate(dataPrevista)}
                onSelect={(d) => {
                  if (!d) return;
                  setDataPrevista(formatDateToYYYYMMDD(d));
                  setIsCalendarOpen(false);
                }}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* Fixada */}
        <div className="flex items-center justify-between rounded-xl border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="tarefa-fixada" className="text-sm font-medium">
              Fixar no topo
            </Label>
            <p className="text-xs text-muted-foreground">
              Mantém este item em destaque prioritário no topo das listas.
            </p>
          </div>
          <Switch
            id="tarefa-fixada"
            checked={fixada}
            onCheckedChange={setFixada}
          />
        </div>

        {/* Informações secundárias / Metadados */}
        <div className="space-y-2 rounded-xl border bg-muted/25 p-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Clock className="size-3.5 shrink-0" aria-hidden="true" />
            <span>Criada em: {formatDateTime(tarefa.created_at) || "—"}</span>
          </div>
          {tarefa.completed_at && (
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <Check className="size-3.5 shrink-0" aria-hidden="true" />
              <span>Concluída em: {formatDateTime(tarefa.completed_at)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Rodapé com Ações */}
      <SheetFooter className="border-t p-4 sm:justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onOpenDelete}
          disabled={isSaving || isDeleting}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-4" />
          Excluir
        </Button>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={!titulo.trim() || isSaving}
            className="gap-1.5"
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Salvar
          </Button>
        </div>
      </SheetFooter>
    </form>
  );
}

export function TaskDetailSheet({
  tarefa,
  isOpen,
  onClose,
  onSave,
  onDelete,
  isSaving,
  isDeleting,
}: TaskDetailSheetProps) {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  async function handleConfirmDelete() {
    if (!tarefa || isDeleting) return;
    await onDelete(tarefa.id);
    setConfirmDeleteOpen(false);
    onClose();
  }

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          side="right"
          className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-md"
        >
          {tarefa ? (
            <TaskFormContent
              key={tarefa.id}
              tarefa={tarefa}
              onClose={onClose}
              onSave={onSave}
              onOpenDelete={() => setConfirmDeleteOpen(true)}
              isSaving={isSaving}
              isDeleting={isDeleting}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Diálogo de confirmação de exclusão */}
      <AlertDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este item?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação excluirá permanentemente &quot;{tarefa?.titulo}&quot;. Esta operação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Excluindo...
                </>
              ) : (
                "Excluir definitivamente"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
