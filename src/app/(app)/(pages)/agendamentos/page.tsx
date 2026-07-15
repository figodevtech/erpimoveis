"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  User,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "@/lib/toast";
import CustomerSelect from "@/app/(app)/components/customerSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { StatusAgendamento } from "@/types/agendamento";
import type { Customer } from "../clientes/types";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { cn } from "@/lib/utils";

type VeiculoOption = { id: number; clienteid: number; placa: string; modelo?: string | null; marca?: string | null };
type ServicoOption = { id: number; codigo?: string | null; descricao: string; permite_agendamento?: boolean | null };

function isSchedulingService(value: ServicoOption["permite_agendamento"] | string | number | undefined) {
  return value === true || value === "true" || value === 1 || value === "1";
}

type AgendamentoItem = {
  id: number;
  clienteid?: number | null;
  veiculoid?: number | null;
  titulo: string;
  descricao?: string | null;
  inicio: string;
  fim?: string | null;
  status: StatusAgendamento;
  origem?: "ERP" | "SITE" | null;
  motivorecusa?: string | null;
  mensagemnotificacao?: string | null;
  canalnotificacao?: string | null;
  solicitante_nome?: string | null;
  solicitante_cpfcnpj?: string | null;
  solicitante_telefone?: string | null;
  solicitante_email?: string | null;
  cliente?: { id: number; nomerazaosocial: string; telefone?: string | null; email?: string | null } | null;
  veiculo?: { id: number; placa: string; modelo?: string | null; marca?: string | null } | null;
};

type FormState = {
  id?: number;
  clienteid: string;
  veiculoid: string;
  titulo: string;
  descricao: string;
  inicio: string;
  fim: string;
  status: StatusAgendamento;
  origem?: "ERP" | "SITE" | null;
  solicitante_nome?: string | null;
  solicitante_cpfcnpj?: string | null;
  solicitante_telefone?: string | null;
  solicitante_email?: string | null;
};

type CalendarView = "MES" | "SEMANA" | "DIA" | "AGENDA";
type AgendamentoConfig = {
  intervalo: number;
  horaInicio: string;
  horaFim: string;
  diasTrabalho: number[];
};

const STATUS_LABEL: Record<StatusAgendamento, string> = {
  PENDENTE_APROVACAO: "Pendente",
  AGENDADO: "Agendado",
  RECUSADO: "Recusado",
  CANCELADO: "Cancelado",
};

const EMPTY_FORM: FormState = {
  clienteid: "",
  veiculoid: "none",
  titulo: "",
  descricao: "",
  inicio: "",
  fim: "",
  status: "AGENDADO",
  origem: "ERP",
  solicitante_nome: null,
  solicitante_cpfcnpj: null,
  solicitante_telefone: null,
  solicitante_email: null,
};

const WEEK_DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
const VIEW_LABEL: Record<CalendarView, string> = {
  MES: "Mes",
  SEMANA: "Semana",
  DIA: "Dia",
  AGENDA: "Agenda",
};

function formatDateTime(value?: string | Date | null) {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatTime(value?: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMonthTitle(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(value);
}

function formatDateTitle(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(value);
}

function toDateKey(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthRange(month: Date) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  return {
    start: toDateKey(start),
    end: toDateKey(end),
  };
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(date.getDate() + amount);
  return next;
}

function startOfWeek(date: Date) {
  const start = new Date(date);
  start.setDate(date.getDate() - date.getDay());
  start.setHours(0, 0, 0, 0);
  return start;
}

function visibleRange(view: CalendarView, month: Date, selected: Date) {
  if (view === "MES") return monthRange(month);

  if (view === "SEMANA") {
    const start = startOfWeek(selected);
    return { start: toDateKey(start), end: toDateKey(addDays(start, 6)) };
  }

  if (view === "AGENDA") {
    return { start: toDateKey(selected), end: toDateKey(addDays(selected, 30)) };
  }

  return { start: toDateKey(selected), end: toDateKey(selected) };
}

function periodTitle(view: CalendarView, month: Date, selected: Date) {
  if (view === "MES") return formatMonthTitle(month);
  if (view === "DIA") return formatDateTitle(selected);
  if (view === "AGENDA") {
    return `${formatDateTime(selected).split(",")[0]} - ${formatDateTime(addDays(selected, 30)).split(",")[0]}`;
  }

  const start = startOfWeek(selected);
  const end = addDays(start, 6);
  return `${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(start)} - ${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(end)}`;
}

function calendarDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function isSameMonth(date: Date, month: Date) {
  return date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth();
}

function toDateInput(date: Date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function toInputFromIso(value?: string | null) {
  return value ? toDateInput(new Date(value)) : "";
}

function addMinutesFromInput(value: string, minutes: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() + minutes);
  return toDateInput(date);
}

function timeToMinutes(value: string) {
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

function minutesToTime(value: number) {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function buildSlots(config: AgendamentoConfig) {
  const start = timeToMinutes(config.horaInicio);
  const end = timeToMinutes(config.horaFim);
  const interval = Math.max(15, config.intervalo);
  const slots: number[] = [];

  for (let value = start; value < end; value += interval) {
    slots.push(value);
  }

  return slots;
}

function getDateFromInput(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function getTimeFromInput(value: string) {
  const date = getDateFromInput(value);
  if (!date) return "";
  return minutesToTime(date.getHours() * 60 + date.getMinutes());
}

function combineDateAndTime(date: Date, time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);
  return toDateInput(next);
}

function slotForDate(date: Date, config: AgendamentoConfig) {
  const slots = buildSlots(config);
  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  return slots.find((slot) => slot >= currentMinutes) ?? slots[0] ?? timeToMinutes(config.horaInicio);
}

function defaultInicioForDate(dateBase: Date, config: AgendamentoConfig) {
  const date = new Date(dateBase);
  const hasExplicitTime =
    dateBase.getHours() !== 0 ||
    dateBase.getMinutes() !== 0 ||
    dateBase.getSeconds() !== 0 ||
    dateBase.getMilliseconds() !== 0;

  const slot = hasExplicitTime
    ? slotForDate(dateBase, config)
    : toDateKey(dateBase) === toDateKey(new Date())
      ? slotForDate(new Date(), config)
      : buildSlots(config)[0] ?? timeToMinutes(config.horaInicio);

  date.setHours(Math.floor(slot / 60), slot % 60, 0, 0);
  return toDateInput(date);
}

function isPastCalendarDay(date: Date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return target < today;
}

function normalizeDiasTrabalho(value: unknown) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.replace(/[{}]/g, "").split(",")
      : [];

  const dias = [...new Set(raw.map(Number).filter((dia) => Number.isInteger(dia) && dia >= 0 && dia <= 6))];
  return dias.length > 0 ? dias.sort((a, b) => a - b) : [1, 2, 3, 4, 5];
}

function isWorkingDay(date: Date, diasTrabalho: number[]) {
  return diasTrabalho.includes(date.getDay());
}

function nextWorkingDay(from: Date, diasTrabalho: number[]) {
  const next = new Date(from);
  next.setHours(0, 0, 0, 0);

  for (let i = 0; i < 14; i++) {
    if (!isPastCalendarDay(next) && isWorkingDay(next, diasTrabalho)) return next;
    next.setDate(next.getDate() + 1);
  }

  return new Date(from);
}

function nextSchedulableDay(from: Date, config: AgendamentoConfig) {
  const next = new Date(from);
  next.setHours(0, 0, 0, 0);
  const now = new Date();
  const slots = buildSlots(config);

  for (let i = 0; i < 30; i++) {
    if (!isPastCalendarDay(next) && isWorkingDay(next, config.diasTrabalho)) {
      const hasFutureSlot = slots.some((slot) => {
        const candidate = new Date(next);
        candidate.setHours(Math.floor(slot / 60), slot % 60, 0, 0);
        return candidate.getTime() >= now.getTime();
      });

      if (hasFutureSlot) return next;
    }

    next.setDate(next.getDate() + 1);
  }

  return nextWorkingDay(from, config.diasTrabalho);
}

function hasFutureConfiguredSlot(date: Date, config: AgendamentoConfig) {
  if (isPastCalendarDay(date) || !isWorkingDay(date, config.diasTrabalho)) return false;

  const now = new Date();
  return buildSlots(config).some((slot) => {
    const candidate = new Date(date);
    candidate.setHours(Math.floor(slot / 60), slot % 60, 0, 0);
    return candidate.getTime() >= now.getTime();
  });
}

function statusBadge(status: StatusAgendamento) {
  if (status === "RECUSADO" || status === "CANCELADO") return "destructive";
  if (status === "PENDENTE_APROVACAO") return "outline";
  return "default";
}

function statusEventClass(status: StatusAgendamento) {
  if (status === "PENDENTE_APROVACAO") {
    return "border-l-amber-500 bg-amber-50 text-amber-950 hover:bg-amber-100 dark:bg-amber-950/25 dark:text-amber-100";
  }
  if (status === "RECUSADO") {
    return "border-l-rose-500 bg-rose-50 text-rose-950 hover:bg-rose-100 dark:bg-rose-950/25 dark:text-rose-100";
  }
  if (status === "CANCELADO") {
    return "border-l-slate-400 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:bg-slate-900/40 dark:text-slate-200";
  }
  return "border-l-emerald-500 bg-emerald-50 text-emerald-950 hover:bg-emerald-100 dark:bg-emerald-950/25 dark:text-emerald-100";
}

function emailResultMessage(result: any) {
  if (result?.sent) return "E-mail enviado para o cliente.";
  if (result?.reason === "missing-recipient") return "E-mail nao enviado: cliente sem e-mail cadastrado.";
  if (result?.reason === "missing-api-key") return "E-mail nao enviado: chave do Resend ausente no ERP.";
  if (result?.reason === "resend-error") {
    return `E-mail nao enviado: erro ${result.status ?? ""} retornado pelo Resend.`;
  }
  return "E-mail nao enviado.";
}

function getClienteNome(item: AgendamentoItem) {
  return item.cliente?.nomerazaosocial ?? item.solicitante_nome ?? "-";
}

function getClienteContato(item: AgendamentoItem) {
  return [item.cliente?.telefone ?? item.solicitante_telefone, item.cliente?.email ?? item.solicitante_email]
    .filter(Boolean)
    .join(" · ");
}

function hasFormSolicitante(form: FormState) {
  return Boolean(form.solicitante_nome || form.solicitante_cpfcnpj || form.solicitante_telefone || form.solicitante_email);
}

function getFormClienteNome(form: FormState, cliente: Customer | null) {
  return cliente?.nomerazaosocial ?? form.solicitante_nome ?? "";
}

function getFormClienteCpfCnpj(form: FormState, cliente: Customer | null) {
  return cliente?.cpfcnpj ?? form.solicitante_cpfcnpj ?? "";
}

function getFormClienteTelefone(form: FormState, cliente: Customer | null) {
  return cliente?.telefone ?? form.solicitante_telefone ?? "";
}

function getFormClienteEmail(form: FormState, cliente: Customer | null) {
  return cliente?.email ?? form.solicitante_email ?? "";
}

function CalendarLoadingSkeleton({
  view,
  slots,
  selectedDate,
  weekDays,
}: {
  view: CalendarView;
  slots: number[];
  selectedDate: Date;
  weekDays: Date[];
}) {
  if (view === "MES") {
    return (
      <>
        <div className="grid grid-cols-7 border-b bg-muted/20">
          {WEEK_DAYS.map((day) => (
            <div key={day} className="px-2 py-2 text-center text-xs font-medium text-muted-foreground">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: 42 }).map((_, index) => (
            <div key={index} className="min-h-[116px] space-y-3 border-b border-r p-2">
              <Skeleton className="size-7 rounded-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-11/12" />
                {index % 3 === 0 ? <Skeleton className="h-4 w-2/3" /> : null}
              </div>
            </div>
          ))}
        </div>
      </>
    );
  }

  if (view === "AGENDA") {
    return (
      <div className="divide-y">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="grid gap-3 p-4 md:grid-cols-[180px_1fr_auto] md:items-center">
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-56 max-w-full" />
              <Skeleton className="h-3 w-72 max-w-full" />
            </div>
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </div>
    );
  }

  const columnCount = view === "DIA" ? 1 : 7;
  const visibleDays = view === "DIA" ? [selectedDate] : weekDays;

  return (
    <div className="overflow-x-auto">
      <div
        className="relative grid min-w-[760px]"
        style={{ gridTemplateColumns: `72px repeat(${columnCount}, minmax(130px, 1fr))` }}
      >
        <div className="border-b border-r bg-muted/20 p-2 text-xs font-medium text-muted-foreground">
          Hora
        </div>
        {visibleDays.map((day) => (
          <div key={toDateKey(day)} className="border-b border-r bg-muted/20 p-2 text-center text-xs font-medium text-muted-foreground">
            <div>{WEEK_DAYS[day.getDay()]}</div>
            <div className="text-sm">{day.getDate()}</div>
          </div>
        ))}

        <div className="pointer-events-none absolute bottom-0 left-[72px] right-0 top-[49px] z-10 flex items-center justify-center">
          <div className="flex flex-col items-center justify-center gap-2 rounded-md bg-background/80 px-4 py-3">
            <div className="size-8 animate-spin rounded-t-full border-t-2 border-primary" />
            <span className="text-sm text-primary">Carregando</span>
          </div>
        </div>

        {slots.map((slot) => (
          <div key={slot} className="contents">
            <div className="min-h-[86px] border-b border-r bg-muted/10 p-2">
              <span className="text-xs text-muted-foreground">{minutesToTime(slot)}</span>
            </div>
            {visibleDays.map((day) => (
              <div key={`${toDateKey(day)}-${slot}`} className="min-h-[86px] border-b border-r p-1.5" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function DayDetailsLoadingSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-lg border p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <div className="mt-4 space-y-2">
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AgendamentosPage() {
  const { data: session } = useSession();
  const [items, setItems] = useState<AgendamentoItem[]>([]);
  const [veiculos, setVeiculos] = useState<VeiculoOption[]>([]);
  const [servicosAgendamento, setServicosAgendamento] = useState<ServicoOption[]>([]);
  const [servicosPopoverOpen, setServicosPopoverOpen] = useState(false);
  const [selectedServicoIds, setSelectedServicoIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [agendamentoParaExcluir, setAgendamentoParaExcluir] = useState<AgendamentoItem | null>(null);
  const [agendamentoParaAprovar, setAgendamentoParaAprovar] = useState<AgendamentoItem | null>(null);
  const [agendamentoParaReprovar, setAgendamentoParaReprovar] = useState<AgendamentoItem | null>(null);
  const [motivoReprovacao, setMotivoReprovacao] = useState("");
  const [agendaConfig, setAgendaConfig] = useState<AgendamentoConfig>({
    intervalo: 60,
    horaInicio: "08:00",
    horaFim: "18:00",
    diasTrabalho: [1, 2, 3, 4, 5],
  });
  const [open, setOpen] = useState(false);
  const [openCustomerSelect, setOpenCustomerSelect] = useState(false);
  const [clienteSelecionado, setClienteSelecionado] = useState<Customer | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [filtrosOpen, setFiltrosOpen] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"TODOS" | StatusAgendamento>("TODOS");
  const [draftQ, setDraftQ] = useState("");
  const [draftStatus, setDraftStatus] = useState<"TODOS" | StatusAgendamento>("TODOS");
  const [view, setView] = useState<CalendarView>("SEMANA");
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const today = nextSchedulableDay(new Date(), {
      intervalo: 60,
      horaInicio: "08:00",
      horaFim: "18:00",
      diasTrabalho: [1, 2, 3, 4, 5],
    });
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(() =>
    nextSchedulableDay(new Date(), {
      intervalo: 60,
      horaInicio: "08:00",
      horaFim: "18:00",
      diasTrabalho: [1, 2, 3, 4, 5],
    })
  );
  const calendarPanelRef = useRef<HTMLDivElement | null>(null);
  const [calendarPanelHeight, setCalendarPanelHeight] = useState<number | null>(null);

  const stats = useMemo(() => {
    return {
      total: items.length,
      pendentes: items.filter((item) => item.status === "PENDENTE_APROVACAO").length,
      agendados: items.filter((item) => item.status === "AGENDADO").length,
      recusados: items.filter((item) => item.status === "RECUSADO").length,
      cancelados: items.filter((item) => item.status === "CANCELADO").length,
    };
  }, [items]);

  const veiculosDoCliente = useMemo(
    () => veiculos.filter((veiculo) => String(veiculo.clienteid) === form.clienteid),
    [form.clienteid, veiculos]
  );
  const selectedServicos = useMemo(
    () => servicosAgendamento.filter((servico) => selectedServicoIds.includes(servico.id)),
    [selectedServicoIds, servicosAgendamento]
  );

  const days = useMemo(() => calendarDays(currentMonth), [currentMonth]);
  const weekDays = useMemo(() => {
    const start = startOfWeek(selectedDate);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }, [selectedDate]);
  const slots = useMemo(() => buildSlots(agendaConfig), [agendaConfig]);
  const canCreate = permissionSetHas((session?.user as any)?.permissoes, PERMS.AGENDAMENTOS_CRIAR);
  const canEdit = permissionSetHas((session?.user as any)?.permissoes, PERMS.AGENDAMENTOS_EDITAR);
  const canDelete = permissionSetHas((session?.user as any)?.permissoes, PERMS.AGENDAMENTOS_EXCLUIR);
  const activeRange = useMemo(
    () => visibleRange(view, currentMonth, selectedDate),
    [view, currentMonth, selectedDate]
  );

  const itemsByDay = useMemo(() => {
    const map = new Map<string, AgendamentoItem[]>();

    for (const item of items) {
      const key = toDateKey(item.inicio);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }

    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime());
    }

    return map;
  }, [items]);

  const selectedDayItems = useMemo(
    () => itemsByDay.get(toDateKey(selectedDate)) ?? [],
    [itemsByDay, selectedDate]
  );

  const agendaItems = useMemo(
    () => [...items].sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime()),
    [items]
  );

  function isDayUnavailable(date: Date) {
    return isPastCalendarDay(date) || !isWorkingDay(date, agendaConfig.diasTrabalho);
  }

  function isSlotInPast(date: Date, slot: number) {
    const candidate = new Date(date);
    candidate.setHours(Math.floor(slot / 60), slot % 60, 0, 0);
    return candidate.getTime() < Date.now();
  }

  function isSlotOccupied(date: Date, slot: number, ignoreId?: number) {
    return (itemsByDay.get(toDateKey(date)) ?? []).some((item) => {
      if (ignoreId && item.id === ignoreId) return false;
      if (item.status === "RECUSADO" || item.status === "CANCELADO") return false;
      const inicio = new Date(item.inicio);
      return inicio.getHours() * 60 + inicio.getMinutes() === slot;
    });
  }

  function isSlotUnavailable(date: Date, slot: number, ignoreId?: number) {
    return isDayUnavailable(date) || isSlotInPast(date, slot) || isSlotOccupied(date, slot, ignoreId);
  }

  function firstAvailableSlot(date: Date, preferredSlot?: number, ignoreId?: number) {
    const orderedSlots =
      preferredSlot === undefined
        ? slots
        : [...slots.filter((slot) => slot >= preferredSlot), ...slots.filter((slot) => slot < preferredSlot)];

    return orderedSlots.find((slot) => !isSlotUnavailable(date, slot, ignoreId)) ?? null;
  }

  async function loadLookup() {
    const [lookupResponse, configResponse] = await Promise.all([
      fetch("/api/agendamentos/lookup"),
      fetch("/api/config", { cache: "no-store" }),
    ]);

    const data = await lookupResponse.json();
    if (!lookupResponse.ok) throw new Error(data?.error ?? "Erro ao carregar dados auxiliares");

    const configData = await configResponse.json().catch(() => ({}));
    if (configResponse.ok && configData?.config) {
      const diasTrabalho = normalizeDiasTrabalho(configData.config.agendamento_dias_trabalho);
      setAgendaConfig({
        intervalo: Number(configData.config.agendamento_intervalo_minutos ?? 60),
        horaInicio: String(configData.config.agendamento_hora_inicio ?? "08:00").slice(0, 5),
        horaFim: String(configData.config.agendamento_hora_fim ?? "18:00").slice(0, 5),
        diasTrabalho,
      });

      setSelectedDate((current) => {
        const loadedConfig = {
          intervalo: Number(configData.config.agendamento_intervalo_minutos ?? 60),
          horaInicio: String(configData.config.agendamento_hora_inicio ?? "08:00").slice(0, 5),
          horaFim: String(configData.config.agendamento_hora_fim ?? "18:00").slice(0, 5),
          diasTrabalho,
        };
        if (hasFutureConfiguredSlot(current, loadedConfig)) return current;
        const next = nextSchedulableDay(new Date(), loadedConfig);
        setCurrentMonth(new Date(next.getFullYear(), next.getMonth(), 1));
        return next;
      });
    }

    setVeiculos(data.veiculos ?? []);
  }

  async function loadItems() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: "1",
        limit: view === "AGENDA" ? "300" : "150",
        status,
        dateFrom: activeRange.start,
        dateTo: activeRange.end,
      });
      if (q.trim()) params.set("q", q.trim());

      const response = await fetch(`/api/agendamentos?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "Erro ao carregar agendamentos");
      setItems(data.items ?? []);
    } catch (error: any) {
      toast.error(error?.message ?? "Erro ao carregar agendamentos");
    } finally {
      setLoading(false);
    }
  }

  async function loadServicosAgendamento() {
    try {
      const response = await fetch("/api/tipos/servicos", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "Erro ao carregar servicos");

      const items = ((data.items ?? []) as ServicoOption[]).filter((servico) =>
        isSchedulingService(servico.permite_agendamento)
      );
      setServicosAgendamento(items);
    } catch (error: any) {
      toast.error(error?.message ?? "Erro ao carregar servicos para agendamento");
      setServicosAgendamento([]);
    }
  }

  useEffect(() => {
    loadLookup().catch((error) => toast.error(error?.message ?? "Erro ao carregar dados auxiliares"));
    loadServicosAgendamento();
  }, []);

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, activeRange.start, activeRange.end, view]);

  useEffect(() => {
    if (!loading) setCalendarLoading(false);
  }, [loading]);

  useEffect(() => {
    if (view === "AGENDA" || !calendarPanelRef.current) {
      setCalendarPanelHeight(null);
      return;
    }

    const element = calendarPanelRef.current;
    const updateHeight = () => setCalendarPanelHeight(Math.ceil(element.getBoundingClientRect().height));
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    window.addEventListener("resize", updateHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [view, currentMonth, selectedDate, slots.length, items.length]);

  function openCreate(dateBase = selectedDate) {
    if (!canCreate) {
      toast.error("Sem permissao para criar agendamento.");
      return;
    }

    if (isDayUnavailable(dateBase)) {
      toast.error("Dia indisponivel para agendamento.");
      return;
    }

    const preferredDate = getDateFromInput(defaultInicioForDate(dateBase, agendaConfig)) ?? dateBase;
    const preferredSlot = preferredDate.getHours() * 60 + preferredDate.getMinutes();
    const availableSlot = firstAvailableSlot(dateBase, preferredSlot);

    if (availableSlot === null) {
      toast.error("Nao ha horarios disponiveis neste dia.");
      return;
    }

    const inicio = combineDateAndTime(dateBase, minutesToTime(availableSlot));

    setForm({
      ...EMPTY_FORM,
      inicio,
      fim: addMinutesFromInput(inicio, agendaConfig.intervalo),
    });
    setSelectedServicoIds([]);
    setServicosPopoverOpen(false);
    setClienteSelecionado(null);
    setOpen(true);
  }

  function openEdit(item: AgendamentoItem) {
    if (!canEdit) {
      toast.error("Sem permissao para editar agendamento.");
      return;
    }

    const inicio = toInputFromIso(item.inicio);
    const fim = toInputFromIso(item.fim);
    setForm({
      id: item.id,
      clienteid: item.clienteid ? String(item.clienteid) : "",
      veiculoid: item.veiculoid ? String(item.veiculoid) : "none",
      titulo: item.titulo,
      descricao: item.descricao ?? "",
      inicio,
      fim,
      status: item.status,
      origem: item.origem ?? null,
      solicitante_nome: item.solicitante_nome ?? null,
      solicitante_cpfcnpj: item.solicitante_cpfcnpj ?? null,
      solicitante_telefone: item.solicitante_telefone ?? null,
      solicitante_email: item.solicitante_email ?? null,
    });
    setSelectedServicoIds([]);
    setServicosPopoverOpen(false);
    setClienteSelecionado(
      item.cliente
        ? ({
          id: item.cliente.id,
          nomerazaosocial: item.cliente.nomerazaosocial,
          telefone: item.cliente.telefone ?? "",
          email: item.cliente.email ?? "",
        } as Customer)
        : null
    );
    setOpen(true);
  }

  async function save() {
    if (form.id ? !canEdit : !canCreate) {
      toast.error("Sem permissao para salvar agendamento.");
      return;
    }

    if (!form.clienteid && !String(form.solicitante_nome ?? "").trim()) {
      toast.error("Selecione um cliente ou informe o nome do solicitante.");
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, any> = {
        veiculoid: form.veiculoid === "none" ? null : Number(form.veiculoid),
        titulo: form.titulo,
        descricao: form.descricao || null,
        inicio: form.inicio ? new Date(form.inicio).toISOString() : "",
        fim: form.inicio ? new Date(addMinutesFromInput(form.inicio, agendaConfig.intervalo)).toISOString() : null,
        status: form.status,
      };

      if (form.clienteid) {
        payload.clienteid = Number(form.clienteid);
      } else if (hasFormSolicitante(form)) {
        payload.clienteid = null;
      }

      payload.solicitante_nome = form.clienteid ? null : form.solicitante_nome?.trim() || null;
      payload.solicitante_cpfcnpj = form.clienteid ? null : form.solicitante_cpfcnpj?.trim() || null;
      payload.solicitante_telefone = form.clienteid ? null : form.solicitante_telefone?.trim() || null;
      payload.solicitante_email = form.clienteid ? null : form.solicitante_email?.trim() || null;

      const response = await fetch(form.id ? `/api/agendamentos/${form.id}` : "/api/agendamentos", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "Erro ao salvar agendamento");

      toast.success(form.id ? "Agendamento atualizado" : "Agendamento criado");
      setOpen(false);
      await loadItems();
    } catch (error: any) {
      toast.error(error?.message ?? "Erro ao salvar agendamento");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    if (!canDelete) {
      toast.error("Sem permissao para excluir agendamento.");
      return;
    }

    setDeleting(true);
    try {
      const response = await fetch(`/api/agendamentos/${id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "Erro ao excluir agendamento");
      toast.success("Agendamento excluido");
      setAgendamentoParaExcluir(null);
      await loadItems();
    } catch (error: any) {
      toast.error(error?.message ?? "Erro ao excluir agendamento");
    } finally {
      setDeleting(false);
    }
  }

  async function decideAgendamento(item: AgendamentoItem, action: "aprovar" | "reprovar", motivo?: string) {
    if (!canEdit) {
      toast.error("Sem permissao para editar agendamento.");
      return;
    }

    setDeciding(true);
    try {
      const response = await fetch(`/api/agendamentos/${item.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "reprovar" ? { motivo } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "Erro ao atualizar agendamento");

      toast.success(action === "aprovar" ? "Agendamento aprovado" : "Agendamento recusado");
      const emailResult = data?.notificacao?.emailResult;
      if (emailResult?.sent) {
        toast.success("E-mail enviado ao cliente.");
      } else if (emailResult) {
        toast.warning(emailResultMessage(emailResult));
      }

      if (!emailResult?.sent && data?.notificacao?.whatsappUrl) {
        window.open(data.notificacao.whatsappUrl, "_blank", "noopener,noreferrer");
      } else if (data?.notificacao?.message) {
        toast.message("Mensagem para o cliente", { description: data.notificacao.message });
      }
      setAgendamentoParaAprovar(null);
      setAgendamentoParaReprovar(null);
      setMotivoReprovacao("");
      await loadItems();
    } catch (error: any) {
      toast.error(error?.message ?? "Erro ao atualizar agendamento");
    } finally {
      setDeciding(false);
    }
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === "clienteid") {
        next.veiculoid = "none";
      }
      if (key === "inicio") {
        next.fim = addMinutesFromInput(String(value), agendaConfig.intervalo);
      }
      return next;
    });
  }

  function toggleServico(servico: ServicoOption) {
    setSelectedServicoIds((current) => {
      const exists = current.includes(servico.id);
      const nextIds = exists ? current.filter((id) => id !== servico.id) : [...current, servico.id];
      const nextServicos = servicosAgendamento.filter((item) => nextIds.includes(item.id));
      setField("titulo", nextServicos.map((item) => item.descricao).join(", "));
      return nextIds;
    });
  }

  function setInicioDate(date?: Date) {
    if (!date) return;
    if (isDayUnavailable(date)) {
      toast.error("Dia indisponivel para agendamento.");
      return;
    }

    setForm((current) => {
      const currentTime = getTimeFromInput(current.inicio);
      const preferredSlot = currentTime ? timeToMinutes(currentTime) : undefined;
      const availableSlot = firstAvailableSlot(date, preferredSlot, current.id);

      if (availableSlot === null) {
        toast.error("Nao ha horarios disponiveis neste dia.");
        return current;
      }

      const time = minutesToTime(availableSlot);
      const inicio = combineDateAndTime(date, time);
      return {
        ...current,
        inicio,
        fim: addMinutesFromInput(inicio, agendaConfig.intervalo),
      };
    });
  }

  function setInicioTime(time: string) {
    setForm((current) => {
      const date = getDateFromInput(current.inicio) ?? selectedDate;
      const slot = timeToMinutes(time);

      if (isSlotUnavailable(date, slot, current.id)) {
        toast.error("Horario indisponivel.");
        return current;
      }

      const inicio = combineDateAndTime(date, time);
      return {
        ...current,
        inicio,
        fim: addMinutesFromInput(inicio, agendaConfig.intervalo),
      };
    });
  }

  function goPrevious() {
    setCalendarLoading(true);
    if (view === "MES") {
      setCurrentMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1));
      return;
    }

    setSelectedDate((date) => {
      return addDays(date, view === "SEMANA" ? -7 : view === "AGENDA" ? -30 : -1);
    });
  }

  function goNext() {
    setCalendarLoading(true);
    if (view === "MES") {
      setCurrentMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1));
      return;
    }

    setSelectedDate((date) => {
      const next = addDays(date, view === "SEMANA" ? 7 : view === "AGENDA" ? 30 : 1);
      if (view === "DIA" && isDayUnavailable(next)) return nextWorkingDay(next, agendaConfig.diasTrabalho);
      return next;
    });
  }

  function goToday() {
    setCalendarLoading(true);
    const next = nextWorkingDay(new Date(), agendaConfig.diasTrabalho);
    setCurrentMonth(new Date(next.getFullYear(), next.getMonth(), 1));
    setSelectedDate(next);
  }

  function selectDay(day: Date) {
    setSelectedDate(day);
    if (view === "MES") {
      setCurrentMonth(new Date(day.getFullYear(), day.getMonth(), 1));
    }
  }

  function openFiltros() {
    setDraftQ(q);
    setDraftStatus(status);
    setFiltrosOpen(true);
  }

  function applyFiltros() {
    setQ(draftQ);
    setStatus(draftStatus);
    setFiltrosOpen(false);
  }

  function clearFiltros() {
    setDraftQ("");
    setDraftStatus("TODOS");
    setQ("");
    setStatus("TODOS");
    setFiltrosOpen(false);
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        <Card className="rounded-lg py-4">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <CalendarDays className="size-4" />
              Periodo
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 text-2xl font-semibold">{stats.total}</CardContent>
        </Card>
        <Card className="rounded-lg py-4">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Clock className="size-4" />
              Pendentes
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 text-2xl font-semibold">{stats.pendentes}</CardContent>
        </Card>
        <Card className="rounded-lg py-4">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="size-4" />
              Agendados
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 text-2xl font-semibold">{stats.agendados}</CardContent>
        </Card>
        <Card className="rounded-lg py-4">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <XCircle className="size-4" />
              Recusados
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 text-2xl font-semibold">{stats.recusados}</CardContent>
        </Card>
        <Card className="rounded-lg py-4">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Trash2 className="size-4" />
              Cancelados
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 text-2xl font-semibold">{stats.cancelados}</CardContent>
        </Card>
      </div>

      <Card className="rounded-lg">
        <CardHeader className="border-b-2 pb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Agenda</CardTitle>
              <button
                onClick={loadItems}
                className="inline-flex items-center gap-1 text-sm text-foreground/50 hover:text-foreground/70 hover:cursor-pointer"
              >
                <span>Recarregar</span>
                <Loader2 width={12} className={loading ? "animate-spin" : ""} />
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Sheet open={filtrosOpen} onOpenChange={setFiltrosOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1" onClick={openFiltros}>
                    <SlidersHorizontal className="h-4 w-4" />
                    Filtros
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>Filtros de agendamentos</SheetTitle>
                  </SheetHeader>
                  <div className="grid flex-1 auto-rows-min gap-6 px-4">
                    <div className="space-y-2">
                      <Label htmlFor="filtro-agendamento-busca">Busca</Label>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                        <Input
                          id="filtro-agendamento-busca"
                          className="pl-9"
                          placeholder="Titulo ou cliente"
                          value={draftQ}
                          onChange={(event) => setDraftQ(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") applyFiltros();
                          }}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Select value={draftStatus} onValueChange={(value) => setDraftStatus(value as any)}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="TODOS">Todos os status</SelectItem>
                          {Object.entries(STATUS_LABEL).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="mt-2 flex justify-between gap-2">
                      <Button type="button" variant="outline" onClick={clearFiltros}>
                        Limpar filtros
                      </Button>
                      <Button type="button" onClick={applyFiltros}>
                        Aplicar filtros
                      </Button>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
              {(q || status !== "TODOS") ? (
                <Badge variant="secondary">
                  {[q ? "Busca ativa" : null, status !== "TODOS" ? STATUS_LABEL[status] : null].filter(Boolean).join(" · ")}
                </Badge>
              ) : null}
              {canCreate ? (
                <Button onClick={() => openCreate()}>
                  <Plus className="size-4" />
                  Novo agendamento
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-4 pt-4 md:px-6">

          <div className={view === "AGENDA" ? "space-y-4" : "grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]"}>
            <div ref={calendarPanelRef} className="relative overflow-hidden rounded-lg border">
              <div className="flex flex-col gap-3 border-b bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={goPrevious}
                    title="Periodo anterior"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <div className="min-w-[220px] text-center text-sm font-semibold capitalize">
                    {periodTitle(view, currentMonth, selectedDate)}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={goNext}
                    title="Proximo periodo"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Tabs
                    value={view}
                    onValueChange={(value) => {
                      setCalendarLoading(true);
                      setView(value as CalendarView);
                    }}
                  >
                    <div className="max-w-full overflow-x-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
                      <TabsList className="h-auto min-w-max justify-start gap-1.5 rounded-2xl border bg-muted/40 p-1 backdrop-blur-sm">
                        {(Object.keys(VIEW_LABEL) as CalendarView[]).map((item) => (
                          <TabsTrigger
                            key={item}
                            value={item}
                            className="h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                          >
                            {VIEW_LABEL[item]}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </div>
                  </Tabs>
                  <Button type="button" variant="outline" onClick={goToday}>
                    Hoje
                  </Button>
                </div>
              </div>

              <div
                key={`${view}-${activeRange.start}-${activeRange.end}`}
                className="transition-opacity duration-200 motion-safe:animate-in motion-safe:fade-in-0"
              >
                {loading && calendarLoading ? (
                  <CalendarLoadingSkeleton
                    view={view}
                    slots={slots}
                    selectedDate={selectedDate}
                    weekDays={weekDays}
                  />
                ) : (
                  <>
                    {view === "MES" ? (
                      <>
                        <div className="grid grid-cols-7 border-b bg-muted/20">
                          {WEEK_DAYS.map((day) => (
                            <div key={day} className="px-2 py-2 text-center text-xs font-medium text-muted-foreground">
                              {day}
                            </div>
                          ))}
                        </div>

                        <div className="grid grid-cols-7">
                          {days.map((day) => {
                            const key = toDateKey(day);
                            const dayItems = itemsByDay.get(key) ?? [];
                            const selected = key === toDateKey(selectedDate);
                            const today = key === toDateKey(new Date());
                            const unavailableDay = isDayUnavailable(day);

                            return (
                              <div
                                key={key}
                                role="button"
                                tabIndex={0}
                                onClick={() => selectDay(day)}
                                onDoubleClick={() => {
                                  if (!unavailableDay) openCreate(day);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    selectDay(day);
                                  }
                                }}
                                className={[
                                  "min-h-[116px] border-b border-r p-2 text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-ring",
                                  !isSameMonth(day, currentMonth) || unavailableDay ? "bg-muted/20 text-muted-foreground" : "bg-background",
                                  selected ? "ring-2 ring-inset ring-primary" : "",
                                ].join(" ")}
                              >
                                <div className="mb-2 flex items-center justify-between gap-1">
                                  <span
                                    className={[
                                      "flex size-7 items-center justify-center rounded-full text-xs font-medium",
                                      today ? "bg-primary text-primary-foreground" : "",
                                    ].join(" ")}
                                  >
                                    {day.getDate()}
                                  </span>
                                  {dayItems.length > 0 ? (
                                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                                      {dayItems.length}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="space-y-1">
                                  {dayItems.slice(0, 3).map((item) => (
                                    <div
                                      key={item.id}
                                      role="button"
                                      tabIndex={0}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        openEdit(item);
                                      }}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          openEdit(item);
                                        }
                                      }}
                                      className={[
                                        "truncate rounded-md border border-l-4 px-2 py-1 text-[11px] shadow-sm",
                                        statusEventClass(item.status),
                                      ].join(" ")}
                                      title={`${formatTime(item.inicio)} - ${item.titulo}`}
                                    >
                                      <span className="font-medium">{formatTime(item.inicio)}</span>{" "}

                                      <span>{item.titulo}</span>
                                    </div>
                                  ))}
                                  {dayItems.length > 3 ? (
                                    <div className="px-2 text-[11px] text-muted-foreground">+{dayItems.length - 3} mais</div>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ) : null}

                    {view === "SEMANA" || view === "DIA" ? (
                      <div className="overflow-x-auto">
                        <div
                          className="min-w-[760px] grid"
                          style={{ gridTemplateColumns: `72px repeat(${view === "DIA" ? 1 : 7}, minmax(130px, 1fr))` }}
                        >
                          <div className="border-b border-r bg-muted/20 p-2 text-xs font-medium text-muted-foreground">
                            Hora
                          </div>
                          {(view === "DIA" ? [selectedDate] : weekDays).map((day) => {
                            const selected = toDateKey(day) === toDateKey(selectedDate);
                            const unavailableDay = isDayUnavailable(day);
                            return (
                              <button
                                key={toDateKey(day)}
                                type="button"
                                onClick={() => setSelectedDate(day)}
                                className={[
                                  "border-b border-r bg-muted/20 p-2 text-center text-xs font-medium hover:bg-muted",
                                  selected ? "text-primary" : "text-muted-foreground",
                                  unavailableDay ? "bg-muted/40" : "",
                                ].join(" ")}
                              >
                                <div>{WEEK_DAYS[day.getDay()]}</div>
                                <div className="text-sm">{day.getDate()}</div>
                              </button>
                            );
                          })}

                          {slots.map((slot) => (
                            <div key={slot} className="contents">
                              <div className="min-h-[86px] border-b border-r bg-muted/10 p-2 text-xs text-muted-foreground">
                                {minutesToTime(slot)}
                              </div>
                              {(view === "DIA" ? [selectedDate] : weekDays).map((day) => {
                                const slotItems = (itemsByDay.get(toDateKey(day)) ?? []).filter(
                                  (item) => {
                                    const date = new Date(item.inicio);
                                    const minutes = date.getHours() * 60 + date.getMinutes();
                                    return minutes >= slot && minutes < slot + agendaConfig.intervalo;
                                  }
                                );
                                const unavailableSlot = isSlotUnavailable(day, slot);

                                return (
                                  <div
                                    key={`${toDateKey(day)}-${slot}`}
                                    role="button"
                                    tabIndex={0}
                                    onDoubleClick={() => {
                                      if (unavailableSlot) return;
                                      const date = new Date(day);
                                      date.setHours(Math.floor(slot / 60), slot % 60, 0, 0);
                                      openCreate(date);
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        if (unavailableSlot) return;
                                        const date = new Date(day);
                                        date.setHours(Math.floor(slot / 60), slot % 60, 0, 0);
                                        openCreate(date);
                                      }
                                    }}
                                    className={[
                                      "min-h-[86px] space-y-1 border-b border-r p-1.5 hover:bg-muted/30 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-ring",
                                      unavailableSlot ? "bg-muted/20 opacity-70" : "",
                                    ].join(" ")}
                                  >
                                    {unavailableSlot && slotItems.length === 0 ? (
                                      <div className="text-[11px] text-muted-foreground">Indisponivel</div>
                                    ) : null}
                                    {slotItems.map((item) => (
                                      <div
                                        key={item.id}
                                        role="button"
                                        tabIndex={0}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          openEdit(item);
                                        }}
                                        onKeyDown={(event) => {
                                          if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            openEdit(item);
                                          }
                                        }}
                                        className={[
                                          "rounded-md border-l-4 px-2 py-1 text-xs",
                                          statusEventClass(item.status),
                                        ].join(" ")}
                                      >
                                        <div className="font-medium flex flex-row items-center gap-2">{formatTime(item.inicio)} {item.origem === "SITE" &&
                                          <Badge className={`text-[9px] py-0 px-1.5 ${item.origem === "SITE" ? "bg-yellow-100 text-yellow-900" : "bg-gray-100 text-gray-800"}`}>{item.origem}</Badge>}</div>
                                        <div className="flex flex-row items-center gap-1">
                                          <Wrench className="size-3" />
                                          <div className="truncate text-muted-foreground">{item.titulo}</div>
                                        </div>
                                        <div className="flex flex-row items-center gap-1">
                                          <User className="size-3" />
                                          <div className="truncate text-muted-foreground">{getClienteNome(item)}</div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {view === "AGENDA" ? (
                      <div className="divide-y">
                        {agendaItems.length === 0 ? (
                          <div className="py-12 text-center text-sm text-muted-foreground">Nenhum agendamento no periodo.</div>
                        ) : (
                          agendaItems.map((item) => (
                            <div
                              key={item.id}
                              className={[
                                "grid gap-3 border-l-4 p-4 md:grid-cols-[180px_1fr_auto] md:items-center",
                                statusEventClass(item.status),
                              ].join(" ")}
                            >
                              <div>
                                <div className="text-sm font-medium capitalize">{formatDateTime(item.inicio)}</div>
                                <div className="text-xs text-muted-foreground">{item.fim ? `Ate ${formatTime(item.fim)}` : ""}</div>
                              </div>
                              <div className="min-w-0">
                                <div className="font-medium">{item.titulo}</div>
                                <div className="truncate text-sm text-muted-foreground">
                                  {getClienteNome(item)}
                                  {item.veiculo ? ` · ${item.veiculo.placa}` : ""}
                                  {item.origem === "SITE" ? " · Site" : ""}
                                </div>
                              </div>
                              <div className="flex items-center justify-end gap-2">
                                <Badge variant={statusBadge(item.status) as any}>{STATUS_LABEL[item.status]}</Badge>
                                {canEdit && item.status === "PENDENTE_APROVACAO" ? (
                                  <>
                                    <Button size="sm" variant="default" onClick={() => setAgendamentoParaAprovar(item)} disabled={deciding}>
                                      <CheckCircle2 className="size-4" />
                                      Aprovar
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => {
                                        setAgendamentoParaReprovar(item);
                                        setMotivoReprovacao("");
                                      }}
                                      disabled={deciding}
                                    >
                                      <XCircle className="size-4" />
                                      Recusar
                                    </Button>
                                  </>
                                ) : null}
                                {canEdit ? (
                                  <Button size="icon" variant="ghost" onClick={() => openEdit(item)} title="Editar">
                                    <Pencil className="size-4" />
                                  </Button>
                                ) : null}
                                {canDelete ? (
                                  <Button size="icon" variant="ghost" onClick={() => setAgendamentoParaExcluir(item)} title="Excluir">
                                    <Trash2 className="size-4" />
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            {view !== "AGENDA" ? (
              <div
                className="flex min-h-0 flex-col overflow-hidden rounded-lg border"
                style={calendarPanelHeight ? { height: calendarPanelHeight } : undefined}
              >
                <div className="flex items-start justify-between gap-3 border-b p-4">
                  <div>
                    <div className="text-sm font-semibold capitalize">{formatDateTitle(selectedDate)}</div>
                    <div className="text-xs text-muted-foreground">
                      {selectedDayItems.length} agendamento(s) no dia
                    </div>
                  </div>
                  {canCreate ? (
                    <Button type="button" size="icon" onClick={() => openCreate(selectedDate)} title="Novo neste dia">
                      <Plus className="size-4" />
                    </Button>
                  ) : null}
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 [scrollbar-width:thin]">
                  {loading && calendarLoading ? (
                    <DayDetailsLoadingSkeleton />
                  ) : selectedDayItems.length === 0 ? (
                    <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                      Nenhum agendamento para este dia.
                    </div>
                  ) : (
                    selectedDayItems.map((item) => (
                      <div
                        key={item.id}
                        className={[
                          "rounded-lg border border-l-4 p-3",
                          statusEventClass(item.status),
                        ].join(" ")}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold">{item.titulo}</div>
                            <div className="text-xs text-muted-foreground">
                              {formatTime(item.inicio)}
                              {item.fim ? ` - ${formatTime(item.fim)}` : ""}
                            </div>
                          </div>
                          <Badge variant={statusBadge(item.status) as any}>{STATUS_LABEL[item.status]}</Badge>
                        </div>

                        <div className="mt-3 space-y-1 text-xs">
                          <div className="font-medium">{getClienteNome(item)}</div>
                          {getClienteContato(item) ? <div className="text-muted-foreground">{getClienteContato(item)}</div> : null}
                          {item.origem === "SITE" ? <div className="text-muted-foreground">Solicitado pelo site</div> : null}
                          {item.veiculo ? (
                            <div className="text-muted-foreground">
                              {item.veiculo.placa} - {item.veiculo.marca ?? ""} {item.veiculo.modelo ?? ""}
                            </div>
                          ) : null}
                          {item.motivorecusa ? <div className="text-muted-foreground">Motivo: {item.motivorecusa}</div> : null}
                          {item.descricao ? <div className="text-muted-foreground">{item.descricao}</div> : null}
                        </div>

                        {canEdit || canDelete ? (
                          <div className="mt-3 flex justify-end gap-1">
                            {canEdit && item.status === "PENDENTE_APROVACAO" ? (
                              <>
                                <Button size="sm" variant="default" onClick={() => setAgendamentoParaAprovar(item)} disabled={deciding}>
                                  <CheckCircle2 className="size-4" />
                                  Aprovar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setAgendamentoParaReprovar(item);
                                    setMotivoReprovacao("");
                                  }}
                                  disabled={deciding}
                                >
                                  <XCircle className="size-4" />
                                  Recusar
                                </Button>
                              </>
                            ) : null}
                            {canEdit ? (
                              <Button size="icon" variant="ghost" onClick={() => openEdit(item)} title="Editar">
                                <Pencil className="size-4" />
                              </Button>
                            ) : null}
                            {canDelete ? (
                              <Button size="icon" variant="ghost" onClick={() => setAgendamentoParaExcluir(item)} title="Excluir">
                                <Trash2 className="size-4" />
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar agendamento" : "Novo agendamento"}</DialogTitle>
            <DialogDescription>Preencha os dados do atendimento agendado.</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 rounded-lg border bg-card p-4">
            {!form.id ? (
              <div className="hidden">
                <Label>Cliente</Label>
                <div className="flex flex-wrap gap-2">
                  <div className="hidden" aria-hidden="true">
                    {clienteSelecionado ? (
                      <>
                        <div className="truncate text-sm font-medium">{clienteSelecionado.nomerazaosocial}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[clienteSelecionado.telefone, clienteSelecionado.email].filter(Boolean).join(" · ")}
                        </div>
                      </>
                    ) : form.solicitante_nome ? (
                      <div className="text-sm text-muted-foreground">Nenhum cliente do ERP vinculado</div>
                    ) : (
                      <div className="text-sm text-muted-foreground">Nenhum cliente selecionado</div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {clienteSelecionado ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          setClienteSelecionado(null);
                          setField("clienteid", "");
                        }}
                        title="Remover cliente"
                      >
                        <X className="size-4" />
                      </Button>
                    ) : null}
                    <CustomerSelect
                      open={openCustomerSelect}
                      setOpen={setOpenCustomerSelect}
                      OnSelect={(cliente) => {
                        setClienteSelecionado(cliente ?? null);
                        setField("clienteid", cliente ? String(cliente.id) : "");
                        setVeiculos((cliente?.veiculos ?? []) as VeiculoOption[]);
                      }}
                    >
                      <Button type="button" variant="outline" size="sm" className="h-8">
                        <Search className="size-4" />
                        Cliente
                      </Button>
                    </CustomerSelect>
                  </div>
                </div>
              </div>
            ) : null}

            {hasFormSolicitante(form) || clienteSelecionado || !form.id ? (
              <div className="space-y-3 ">
                <div className="flex items-center justify-between gap-2">
                  <Label>{clienteSelecionado ? "Dados do cliente" : "Dados do solicitante"}</Label>
                  <div className="flex items-center gap-1.5">
                    {!clienteSelecionado && hasFormSolicitante(form) ? (
                      <Badge variant="outline" className="text-[10px]">
                        Site
                      </Badge>
                    ) : null}
                    {!form.id ? (
                      <>
                        {clienteSelecionado ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              setClienteSelecionado(null);
                              setField("clienteid", "");
                            }}
                            title="Remover cliente"
                          >
                            <X className="size-4" />
                          </Button>
                        ) : null}
                        <CustomerSelect
                          open={openCustomerSelect}
                          setOpen={setOpenCustomerSelect}
                          OnSelect={(cliente) => {
                            setClienteSelecionado(cliente ?? null);
                            setField("clienteid", cliente ? String(cliente.id) : "");
                            setVeiculos((cliente?.veiculos ?? []) as VeiculoOption[]);
                          }}
                        >
                          <Button type="button" variant="outline" size="sm" className="h-8">
                            <Search className="size-4" />
                            Cliente
                          </Button>
                        </CustomerSelect>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="solicitante_nome">Nome</Label>
                    <Input
                      id="solicitante_nome"
                      value={getFormClienteNome(form, clienteSelecionado)}
                      disabled={Boolean(clienteSelecionado || form.id)}
                      onChange={(event) => setField("solicitante_nome", event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="solicitante_cpfcnpj">CPF/CNPJ</Label>
                    <Input
                      id="solicitante_cpfcnpj"
                      value={getFormClienteCpfCnpj(form, clienteSelecionado)}
                      disabled={Boolean(clienteSelecionado || form.id)}
                      onChange={(event) => setField("solicitante_cpfcnpj", event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="solicitante_telefone">Telefone</Label>
                    <Input
                      id="solicitante_telefone"
                      value={getFormClienteTelefone(form, clienteSelecionado)}
                      disabled={Boolean(clienteSelecionado || form.id)}
                      onChange={(event) => setField("solicitante_telefone", event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="solicitante_email">E-mail</Label>
                    <Input
                      id="solicitante_email"
                      value={getFormClienteEmail(form, clienteSelecionado)}
                      disabled={Boolean(clienteSelecionado || form.id)}
                      onChange={(event) => setField("solicitante_email", event.target.value)}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Serviços</Label>
                {!form.id ? (
                  <Popover modal open={servicosPopoverOpen} onOpenChange={setServicosPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline" className="min-h-10 w-full justify-between">
                        <span className="truncate text-left">
                          {selectedServicos.length
                            ? `${selectedServicos.length} servico${selectedServicos.length === 1 ? "" : "s"} selecionado${selectedServicos.length === 1 ? "" : "s"}`
                            : "Selecionar servicos"}
                        </span>
                        <Search className="size-4 shrink-0 text-muted-foreground" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Buscar servico..." />
                        <CommandList
                          className="max-h-64 overscroll-contain"
                          onWheelCapture={(event) => event.stopPropagation()}
                        >
                          <CommandEmpty>Nenhum servico encontrado.</CommandEmpty>
                          <CommandGroup>
                            {servicosAgendamento.map((servico) => {
                              const selected = selectedServicoIds.includes(servico.id);
                              return (
                                <CommandItem
                                  key={servico.id}
                                  value={`${servico.codigo ?? ""} ${servico.descricao}`}
                                  onSelect={() => toggleServico(servico)}
                                >
                                  <Check className={cn("size-4", selected ? "opacity-100" : "opacity-0")} />
                                  <div className="min-w-0">
                                    <div className="truncate">{servico.descricao}</div>
                                    {servico.codigo ? (
                                      <div className="truncate text-xs text-muted-foreground">{servico.codigo}</div>
                                    ) : null}
                                  </div>
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <Input value={form.titulo} onChange={(event) => setField("titulo", event.target.value)} />
                )}
                {!form.id && selectedServicos.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedServicos.map((servico) => (
                      <Badge key={servico.id} variant="secondary" className="gap-1 pr-1">
                        <span className="max-w-[180px] truncate">{servico.descricao}</span>
                        <button
                          type="button"
                          className="rounded-sm p-0.5 hover:bg-muted"
                          onClick={() => toggleServico(servico)}
                          title="Remover servico"
                        >
                          <X className="size-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {!form.id && servicosAgendamento.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhum servico esta habilitado para agendamento.
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label>Veiculo</Label>
                <Select value={form.veiculoid} onValueChange={(value) => setField("veiculoid", value)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem veiculo</SelectItem>
                    {veiculosDoCliente.map((veiculo) => (
                      <SelectItem key={veiculo.id} value={String(veiculo.id)}>
                        {veiculo.placa} - {veiculo.marca} {veiculo.modelo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3 ">
              <div className="space-y-2">
                <Label>Data</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" className="w-full justify-start">
                      <CalendarDays className="size-4" />
                      {form.inicio ? formatDateTime(form.inicio).split(",")[0] : "Selecionar data"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={getDateFromInput(form.inicio)}
                      onSelect={setInicioDate}
                      disabled={isDayUnavailable}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>Horario</Label>
                <Select value={getTimeFromInput(form.inicio)} onValueChange={setInicioTime}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecionar horario" />
                  </SelectTrigger>
                  <SelectContent>
                    {slots.map((slot) => (
                      <SelectItem
                        key={slot}
                        value={minutesToTime(slot)}
                        disabled={isSlotUnavailable(getDateFromInput(form.inicio) ?? selectedDate, slot, form.id)}
                      >
                        {minutesToTime(slot)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(value) => setField("status", value as StatusAgendamento)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_LABEL).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2 ">
              <Label>Descrição</Label>
              <Textarea value={form.descricao} onChange={(event) => setField("descricao", event.target.value)} />
            </div>

          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={save}
              disabled={
                saving ||
                (!form.clienteid && !String(form.solicitante_nome ?? "").trim()) ||
                !form.titulo ||
                !form.inicio ||
                (form.id ? !canEdit : !canCreate)
              }
            >
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!agendamentoParaReprovar}
        onOpenChange={(open) => {
          if (!open && !deciding) {
            setAgendamentoParaReprovar(null);
            setMotivoReprovacao("");
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Recusar agendamento</DialogTitle>
            <DialogDescription>
              Informe o motivo que sera usado na mensagem sugerida para o cliente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label>Motivo</Label>
            <Textarea
              value={motivoReprovacao}
              onChange={(event) => setMotivoReprovacao(event.target.value)}
              placeholder="Ex.: Horario indisponivel. Podemos remarcar para outro periodo."
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAgendamentoParaReprovar(null);
                setMotivoReprovacao("");
              }}
              disabled={deciding}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={deciding}
              onClick={() => {
                if (agendamentoParaReprovar) {
                  void decideAgendamento(agendamentoParaReprovar, "reprovar", motivoReprovacao);
                }
              }}
            >
              {deciding ? "Recusando..." : "Recusar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!agendamentoParaAprovar}
        onOpenChange={(open) => {
          if (!open && !deciding) setAgendamentoParaAprovar(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aprovar agendamento</AlertDialogTitle>
            <AlertDialogDescription>
              Confirme a aprovacao do agendamento
              {agendamentoParaAprovar
                ? ` de ${getClienteNome(agendamentoParaAprovar)}`
                : ""}
              {agendamentoParaAprovar?.inicio ? ` para ${formatDateTime(agendamentoParaAprovar.inicio)}` : ""}.
              O cliente sera notificado quando houver e-mail cadastrado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deciding}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deciding}
              onClick={(event) => {
                event.preventDefault();
                if (agendamentoParaAprovar) void decideAgendamento(agendamentoParaAprovar, "aprovar");
              }}
            >
              {deciding ? "Aprovando..." : "Aprovar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!agendamentoParaExcluir}
        onOpenChange={(open) => {
          if (!open && !deleting) setAgendamentoParaExcluir(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir agendamento</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acao remove o agendamento
              {agendamentoParaExcluir?.titulo ? ` "${agendamentoParaExcluir.titulo}"` : ""}. Essa operacao nao pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                if (agendamentoParaExcluir) void remove(agendamentoParaExcluir.id);
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
