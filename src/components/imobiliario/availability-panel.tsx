"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import ValueInput from "@/components/ui/value-input";
import { EntityShell, Field, RemoteState, StatusBadge, requestJson, useModulePermission, useRemote } from "./shared";
import { type Entity, dateLabel, money } from "./model";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { DatePicker } from "@/components/ui/date-picker";
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
import { cn } from "@/lib/utils";
import { useConfig } from "@/app/(app)/(pages)/config-context";
import { AirbnbCodeLink } from "./airbnb";
import { hospedesAConfirmar } from "@/lib/imobiliario/airbnb";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Home,
  CalendarCheck,
  CalendarRange,
  CalendarX,
  Calculator,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Coins,
  DoorOpen,
  Undo2,
  User,
  Users,
  XCircle,
  Loader2,
  Lock,
  Pencil,
  Trash2,
  Wrench,
  X,
} from "lucide-react";

/* Datas civis (AAAA-MM-DD). No banco o fim é exclusivo (dia de saída); na tela, o operador
   escolhe o último dia/noite e o painel converte com `addDays(ultimo, 1)`. */
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
export const todayCivil = () => new Date().toLocaleDateString("en-CA");
export const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// dot: marcador da lista do mês, nas cores das faixas do calendário.
const KINDS: Record<string, { label: string; dot: string }> = {
  RESERVA: { label: "Reserva", dot: "bg-[#2f6684]" },
  BLOQUEIO: { label: "Bloqueio", dot: "bg-[#c0392b]" },
  MANUTENCAO: { label: "Manutenção", dot: "bg-[#c0392b]" },
};
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// Evento do Airbnb marcado como reserva conta como reserva (cor, rótulo), embora no banco seja um bloqueio externo.
const kindOf = (row: Entity) =>
  row.calendario_tipo === "RESERVA" ? "RESERVA" : String(row.tipo ?? row.origem ?? "").toUpperCase();
const isBlock = (row: Entity) => ["BLOQUEIO", "MANUTENCAO"].includes(kindOf(row)) || Boolean(row.bloqueio_id);
/** Ocupa a noite `day`? (início incluso, fim exclusivo; sem fim segue aberta). */
export const covers = (row: Entity, day: string) => row.inicio <= day && (!row.fim || day < row.fim);

function periodText(row: Entity) {
  if (isBlock(row)) {
    const last = row.fim ? addDays(row.fim, -1) : null;
    return last && last !== row.inicio
      ? `${dateLabel(row.inicio)} a ${dateLabel(last)} · ${plural(daysBetween(row.inicio, row.fim), "dia", "dias")}`
      : `${dateLabel(row.inicio)} · 1 dia`;
  }
  if (!row.fim) return `Desde ${dateLabel(row.inicio)} · sem data de saída`;
  return `Entrada ${dateLabel(row.inicio)} · Saída ${dateLabel(row.fim)} · ${plural(daysBetween(row.inicio, row.fim), "noite", "noites")}`;
}

/** Rótulo curto com dia da semana: "seg., 12 jan.". */
const shortDay = (date: string) =>
  new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short" }).format(new Date(`${date}T12:00:00`));

/* ------------------------------------------------------------------ calendário de ocupação
   Mesmo desenho do calendário do painel do proprietário (site): semanas completas e cada
   ocupação como uma faixa contínua por cima dos dias. A reserva vai da hora de entrada até a
   hora de saída, então no dia de troca de hóspedes cada uma ocupa só a sua parte do dia; o
   bloqueio ocupa os dias inteiros. Posições em dias desde 1970 (fração = hora do dia). */

const DAY_MS = 86_400_000;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)/;
/** Fim de ocupação sem data (locação aberta): número finito bem à frente. */
const OPEN_END = 1e7;
/** Altura do cabeçalho do dia (número), de cada linha de faixas e da faixa, em px. */
const CAL_HEAD = 26;
const CAL_LANE = 22;
const CAL_BAR = 18;

/** Posição de um dia + hora ("HH:MM") na escala do calendário. */
const position = (day: string, time = "00:00") => {
  const match = TIME_RE.exec(time);
  return Date.parse(`${String(day).slice(0, 10)}T00:00:00Z`) / DAY_MS + (match ? (Number(match[1]) * 60 + Number(match[2])) / 1440 : 0);
};
const validTime = (value: unknown, fallback: string) =>
  typeof value === "string" && TIME_RE.test(value) ? value.slice(0, 5) : fallback;

/** Dia civil e hora de um instante no fuso do imobiliário (João Pessoa). */
function localMoment(iso: unknown) {
  const time = typeof iso === "string" ? Date.parse(iso) : NaN;
  if (!Number.isFinite(time)) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Fortaleza",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(time)
      .map((part) => [part.type, part.value])
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Cores das faixas: as mesmas do painel do proprietário, mais o tom do Airbnb. */
const TONES = {
  confirmada: { label: "Confirmada", bar: "bg-[#2f6684]" },
  hospedado: { label: "Hospedado", bar: "bg-[#3f7d5c]" },
  concluida: { label: "Concluída", bar: "bg-[#8d969c]" },
  airbnb: { label: "Airbnb (não registrada)", bar: "bg-[#e0565b]" },
  own: { label: "Uso próprio", bar: "bg-[#6b5b95]" },
  busy: { label: "Ocupado (outro canal)", bar: "bg-[#4a5660]" },
  block: { label: "Bloqueio ou manutenção", bar: "bg-[#c0392b]" },
} as const;
type Tone = keyof typeof TONES;

const RESERVATION_STATUS: Record<string, { tone: Tone; label: string }> = {
  CONFIRMADA: { tone: "confirmada", label: "Confirmada" },
  EM_ANDAMENTO: { tone: "hospedado", label: "Hospedado" },
  CONCLUIDA: { tone: "concluida", label: "Concluída" },
};

type CalendarEvent = {
  key: string;
  start: number;
  end: number;
  label: string;
  description: string;
  tone: Tone;
  icon: "ban" | "wrench" | "lock" | "home" | null;
  airbnb: boolean;
  /** Reserva do ERP que a faixa abre ao ser clicada. */
  reservaId: number | null;
};

/**
 * Ocupações do imóvel como faixas. A hora da reserva: a registrada no ERP quando cai no próprio
 * dia previsto (check-in antecipado, check-out tardio); senão a da reserva; senão a do imóvel.
 */
function occupancyEvents(rows: Entity[], defaults: { checkin?: unknown; checkout?: unknown }) {
  const baseIn = validTime(defaults.checkin, "14:00");
  const baseOut = validTime(defaults.checkout, "12:00");
  const events: CalendarEvent[] = [];
  for (const row of rows) {
    if (!row.inicio) continue;
    const reserva: Entity | null = row.reserva ?? null;
    const asStay = kindOf(row) === "RESERVA" || row.tipo === "LOCACAO";
    let start: number;
    let end: number;
    let entrada = "";
    let saida = "";
    if (asStay) {
      const registeredIn = localMoment(reserva?.checkin_em);
      const registeredOut = localMoment(reserva?.checkout_em);
      const inTime = registeredIn?.day === String(row.inicio).slice(0, 10) ? registeredIn.time : validTime(reserva?.horario_checkin, baseIn);
      const outTime =
        row.fim && registeredOut?.day === String(row.fim).slice(0, 10) ? registeredOut.time : validTime(reserva?.horario_checkout, baseOut);
      start = position(row.inicio, inTime);
      end = row.fim ? position(row.fim, outTime) : OPEN_END;
      entrada = `entrada ${dateLabel(row.inicio)} às ${inTime}`;
      saida = row.fim ? `saída ${dateLabel(row.fim)} às ${outTime}` : "sem data de saída";
    } else {
      // Bloqueio [inicio, fim): vale até o fim do dia anterior a "fim".
      start = position(row.inicio);
      end = row.fim ? position(row.fim) : OPEN_END;
    }
    if (!Number.isFinite(start) || !(end > start)) continue;

    const codigo = row.calendario_codigo ? String(row.calendario_codigo) : null;
    const airbnb = Boolean(codigo) || reserva?.origem === "AIRBNB";
    let tone: Tone;
    let label: string;
    let icon: CalendarEvent["icon"] = null;
    if (row.reserva_id) {
      const status = RESERVATION_STATUS[String(reserva?.status ?? "CONFIRMADA")] ?? RESERVATION_STATUS.CONFIRMADA;
      const hospede = reserva?.cliente?.codigo_sistema ? null : reserva?.cliente?.nomerazaosocial;
      tone = status.tone;
      label = `#${row.reserva_id} · ${hospede || (airbnb ? "Airbnb" : status.label)}`;
    } else if (row.calendario_tipo === "RESERVA") {
      tone = "airbnb";
      label = codigo ? `Airbnb · ${codigo}` : "Reserva Airbnb";
    } else if (row.tipo === "LOCACAO") {
      tone = "busy";
      icon = "lock";
      label = "Locação";
    } else if (row.canal_calendario_id && row.calendario_tipo !== "BLOQUEIO") {
      tone = "busy";
      icon = "lock";
      label = row.motivo || "Ocupado";
    } else if (row.solicitado_por) {
      tone = "own";
      icon = "home";
      label = "Uso próprio";
    } else {
      tone = "block";
      icon = row.tipo === "MANUTENCAO" ? "wrench" : "ban";
      const tipo = row.tipo === "MANUTENCAO" ? "Manutenção" : "Bloqueio";
      label = row.canal_calendario_id ? row.motivo || tipo : row.motivo ? `${tipo} · ${row.motivo}` : tipo;
    }
    events.push({
      key: String(row.id ?? `${row.inicio}-${row.reserva_id ?? ""}`),
      start,
      end,
      label,
      description: asStay ? `${label}: ${entrada}, ${saida}` : `${label}: ${periodText(row)}`,
      tone,
      icon,
      airbnb,
      reservaId: row.reserva_id && reserva ? Number(row.reserva_id) : null,
    });
  }
  return events.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Semanas (domingo a sábado) que cobrem o mês. */
function monthWeeks(month: string) {
  const first = monthStart(month);
  const weekday = new Date(`${first}T12:00:00Z`).getUTCDay();
  const [year, monthNumber] = first.split("-").map(Number);
  const last = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  const weeks: string[][] = [];
  for (let day = addDays(first, -weekday); day <= last; day = addDays(day, 7))
    weeks.push(Array.from({ length: 7 }, (_, index) => addDays(day, index)));
  return weeks;
}

/**
 * Pedaços das faixas dentro da semana, cada um na sua linha. Faixas que só se encostam
 * (saída às 12h e entrada às 14h, ou um bloqueio emendando no outro) dividem a linha;
 * só sobreposição de fato abre outra.
 */
function weekSegments(events: CalendarEvent[], week: string[]) {
  const weekStart = position(week[0]);
  const weekEnd = weekStart + 7;
  const laneEnds: number[] = [];
  const segments: { event: CalendarEvent; left: number; width: number; lane: number; before: boolean; after: boolean }[] = [];
  for (const event of events) {
    const start = Math.max(event.start, weekStart);
    const end = Math.min(event.end, weekEnd);
    if (end <= start) continue;
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start + 1e-9);
    if (lane === -1) lane = laneEnds.push(end) - 1;
    else laneEnds[lane] = end;
    segments.push({
      event,
      left: ((start - weekStart) / 7) * 100,
      width: ((end - start) / 7) * 100,
      lane,
      before: event.start < weekStart,
      after: event.end > weekEnd,
    });
  }
  return { segments, lanes: laneEnds.length };
}

const BAR_ICONS = { ban: Ban, wrench: Wrench, lock: Lock, home: Home } as const;

export function OccupancyCalendar({
  month,
  onMonth,
  rows,
  tariffs,
  selection,
  onDayClick,
  isDayDisabled,
  allowPast = false,
  checkinTime,
  checkoutTime,
  onOpenReservation,
}: {
  month: string;
  onMonth: (month: string) => void;
  rows: Entity[];
  tariffs: Entity[];
  /** Período em escolha: `end` nulo enquanto falta o segundo clique. */
  selection?: { start: string | null; end: string | null };
  /** Sem ele o calendário só mostra (perfil sem edição). */
  onDayClick?: (day: string) => void;
  /** Dias que não podem ser escolhidos agora (na reserva: noites ocupadas, saída depois de uma ocupação). */
  isDayDisabled?: (day: string) => boolean;
  /** Na reserva dá para registrar uma estadia que já começou; no painel, o passado não se escolhe. */
  allowPast?: boolean;
  /** Horários padrão do imóvel, para a faixa da reserva sem horário próprio. */
  checkinTime?: unknown;
  checkoutTime?: unknown;
  /** Clique na faixa de uma reserva abre a reserva. Sem ele, as faixas só mostram. */
  onOpenReservation?: (id: number) => void;
}) {
  const today = todayCivil();
  // Enquanto falta o fim, o intervalo acompanha o mouse para mostrar o que será escolhido.
  const [hover, setHover] = useState<string | null>(null);
  const [direction, setDirection] = useState<1 | -1>(1);
  const start = selection?.start ?? null;
  const choosing = Boolean(start && !selection?.end);
  const end = selection?.end ?? (choosing && hover && hover >= start! ? hover : start);
  const [year, monthIndex] = month.split("-").map(Number);
  const title = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(year, monthIndex - 1, 15));
  const shift = (step: 1 | -1) => {
    setDirection(step);
    onMonth(monthStart(new Date(year, monthIndex - 1 + step, 15).toLocaleDateString("en-CA")));
  };
  const events = useMemo(
    () => occupancyEvents(rows, { checkin: checkinTime, checkout: checkoutTime }),
    [rows, checkinTime, checkoutTime]
  );
  const weeks = monthWeeks(month);
  const agora = localMoment(new Date().toISOString());
  const now = agora ? position(agora.day, agora.time) : null;
  const usedTones = new Set(events.map((event) => event.tone));

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3 shadow-xs sm:p-4" onMouseLeave={() => setHover(null)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full hover:cursor-pointer"
          onClick={() => shift(-1)}
          aria-label="Mês anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold capitalize tracking-tight text-foreground sm:text-base">{title}</span>
          {monthStart(today) !== month ? (
            <button
              type="button"
              onClick={() => {
                setDirection(month > monthStart(today) ? -1 : 1);
                onMonth(monthStart(today));
              }}
              className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:cursor-pointer hover:border-primary/40 hover:text-primary"
            >
              Hoje
            </button>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full hover:cursor-pointer"
          onClick={() => shift(1)}
          aria-label="Próximo mês"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* key no mês: a grade entra deslizando a cada troca, no sentido da navegação. */}
      <div
        key={month}
        className={cn(
          "overflow-hidden rounded-xl border border-border/60 animate-in fade-in-0 duration-300",
          direction > 0 ? "slide-in-from-right-3" : "slide-in-from-left-3"
        )}
      >
        <div className="grid grid-cols-7 border-b border-border/60 bg-muted/40">
          {WEEKDAYS.map((d) => (
            <span key={d} className="py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {d}
            </span>
          ))}
        </div>
        {weeks.map((week, weekIndex) => {
          const { segments, lanes } = weekSegments(events, week);
          const weekStart = position(week[0]);
          const nowLeft = now !== null && now >= weekStart && now < weekStart + 7 ? ((now - weekStart) / 7) * 100 : null;
          return (
            <div
              key={week[0]}
              className={cn("relative", weekIndex > 0 && "border-t border-border/60")}
              style={{ minHeight: Math.max(CAL_HEAD + Math.max(lanes, 1) * CAL_LANE + 6, 60) }}
            >
              <div className="absolute inset-0 grid grid-cols-7">
                {week.map((day, index) => {
                  const outside = day.slice(0, 7) !== month.slice(0, 7);
                  const past = day < today;
                  const pickable = Boolean(onDayClick) && (allowPast || !past) && !isDayDisabled?.(day);
                  const inRange = Boolean(start && end && day >= start && day <= end);
                  const edge = day === start || Boolean(end && day === end);
                  const tariff = tariffs.find((t) => t.ativo !== false && covers(t, day));
                  const occupied = rows.filter((row) => covers(row, day));
                  const label = [
                    dateLabel(day),
                    occupied.length
                      ? occupied
                          .map((row) => events.find((event) => event.key === String(row.id))?.label ?? KINDS[kindOf(row)]?.label ?? "Ocupado")
                          .join(", ")
                      : past
                      ? "Passado"
                      : "Livre",
                    tariff
                      ? `Tarifa ${money(tariff.diaria)}${tariff.descricao ? ` (${tariff.descricao})` : ""}${tariff.reserva_exclusiva ? ", pacote fechado" : ""}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <button
                      key={day}
                      type="button"
                      title={label}
                      aria-label={label}
                      aria-pressed={edge || undefined}
                      disabled={!pickable}
                      onClick={() => pickable && onDayClick?.(day)}
                      onMouseEnter={() => pickable && setHover(day)}
                      className={cn(
                        "relative flex items-start justify-end gap-1 px-1.5 pt-1 outline-none transition-colors duration-150",
                        "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50",
                        index > 0 && "border-l border-border/50",
                        outside ? "bg-muted/45" : past ? "bg-muted/20" : "bg-card",
                        inRange && (choosing ? "bg-primary/[0.07]" : "bg-primary/[0.12]"),
                        edge && "bg-primary/[0.2]",
                        pickable ? "hover:cursor-pointer hover:bg-primary/10" : "cursor-default"
                      )}
                    >
                      {tariff ? <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#c9a96a]" /> : null}
                      <span
                        className={cn(
                          "inline-grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-semibold tabular-nums leading-none",
                          edge
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : day === today
                            ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                            : outside || (past && !allowPast)
                            ? "font-medium text-muted-foreground/50"
                            : past
                            ? "font-medium text-muted-foreground"
                            : onDayClick && !pickable
                            ? "text-muted-foreground/60"
                            : "text-foreground"
                        )}
                      >
                        {Number(day.slice(8))}
                      </span>
                    </button>
                  );
                })}
              </div>

              <ul className="pointer-events-none absolute inset-0 m-0 list-none p-0" aria-label={`Ocupação de ${dateLabel(week[0])} a ${dateLabel(week[6])}`}>
                {segments.map(({ event, left, width, lane, before, after }) => {
                  const Icon = event.icon ? BAR_ICONS[event.icon] : null;
                  const clickable = Boolean(onOpenReservation && event.reservaId);
                  const barClass = cn(
                    "flex h-full items-center gap-1 overflow-hidden whitespace-nowrap rounded-full px-2 text-left text-[10.5px] font-semibold leading-none text-white shadow-[0_1px_2px_rgba(16,31,36,0.18)]",
                    TONES[event.tone].bar,
                    before && "rounded-l-none",
                    after && "rounded-r-none",
                    clickable && "hover:cursor-pointer hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  );
                  const style = {
                    marginLeft: before ? 0 : 1,
                    marginRight: after ? 0 : 1,
                    width: `calc(100% - ${(before ? 0 : 1) + (after ? 0 : 1)}px)`,
                  };
                  const content = (
                    <>
                      {event.airbnb && event.tone !== "airbnb" ? (
                        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#ff8a8d] ring-1 ring-white/80" />
                      ) : null}
                      {Icon ? <Icon aria-hidden className="h-3 w-3 shrink-0" /> : null}
                      <span className="truncate">{event.label}</span>
                    </>
                  );
                  return (
                    <li
                      key={`${event.key}-${week[0]}`}
                      className={cn("absolute", clickable && "pointer-events-auto")}
                      style={{ left: `${left}%`, width: `${width}%`, minWidth: 6, top: CAL_HEAD + lane * CAL_LANE, height: CAL_BAR }}
                    >
                      {clickable ? (
                        <button
                          type="button"
                          className={barClass}
                          style={style}
                          title={`${event.description}. Clique para abrir a reserva.`}
                          aria-label={`${event.description}. Abrir a reserva.`}
                          onClick={() => event.reservaId && onOpenReservation?.(event.reservaId)}
                        >
                          {content}
                        </button>
                      ) : (
                        <span className={barClass} style={style} title={event.description} aria-label={event.description} role="img">
                          {content}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>

              {nowLeft !== null ? (
                <i aria-hidden className="pointer-events-none absolute inset-y-0 -ml-px w-0.5 bg-primary/70" style={{ left: `${nowLeft}%` }}>
                  <i className="absolute -left-[3px] top-0.5 h-2 w-2 rounded-full bg-primary" />
                </i>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
        {(Object.keys(TONES) as Tone[])
          // Sempre as das reservas e do bloqueio; as demais só quando aparecem no imóvel.
          .filter((tone) => ["confirmada", "hospedado", "concluida", "block"].includes(tone) || usedTones.has(tone))
          .map((tone) => (
            <span key={tone} className="inline-flex items-center gap-1.5">
              <span className={cn("h-2.5 w-4 rounded-full", TONES[tone].bar)} />
              {TONES[tone].label}
            </span>
          ))}
        {events.some((event) => event.airbnb && event.tone !== "airbnb") ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#e0565b]" />
            Veio do Airbnb
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[#c9a96a]" />
          Tarifa especial
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-0.5 rounded-full bg-primary/70" />
          Agora
        </span>
      </div>
    </div>
  );
}

export function DateChip({ label, date, placeholder }: { label: string; date: string | null; placeholder?: string }) {
  return (
    <div
      className={cn(
        "min-w-0 flex-1 rounded-xl border px-3 py-2 transition-colors duration-200",
        date ? "border-primary/30 bg-background" : "border-dashed border-primary/40 bg-transparent"
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("truncate text-sm capitalize", date ? "font-semibold text-foreground" : "text-muted-foreground")}>
        {date ? shortDay(date) : placeholder}
      </p>
    </div>
  );
}

/* Carregamento: mesmas caixas, alturas e espaçamentos do conteúdo real, para nada pular quando
   os dados chegam (o RemoteState trocaria a seção por um spinner de 300px). */
function CalendarSkeleton({ month }: { month: string }) {
  // Mesmo número de semanas do mês que vai aparecer (5 ou 6), para a altura bater.
  const weeks = monthWeeks(month).length;
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3 shadow-xs sm:p-4" aria-hidden>
      <div className="mb-3 flex items-center justify-between gap-2">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-9 w-9 rounded-full" />
      </div>
      <div className="overflow-hidden rounded-xl border border-border/60">
        <div className="grid grid-cols-7 border-b border-border/60 bg-muted/40 py-2">
          {WEEKDAYS.map((d) => (
            <Skeleton key={d} className="mx-auto h-3 w-7" />
          ))}
        </div>
        {Array.from({ length: weeks }, (_, w) => (
          <div key={w} className={cn("relative h-[60px]", w > 0 && "border-t border-border/60")}>
            <div className="grid h-full grid-cols-7">
              {Array.from({ length: 7 }, (_, d) => (
                <div key={d} className={cn("flex justify-end p-1", d > 0 && "border-l border-border/50")}>
                  <Skeleton className="h-4 w-5 rounded-full" />
                </div>
              ))}
            </div>
            {w % 2 === 0 ? <Skeleton className="absolute top-[26px] h-[18px] rounded-full" style={{ left: `${10 + w * 9}%`, width: "34%" }} /> : null}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/50 pt-3">
        {[64, 64, 68, 84, 92].map((w, i) => (
          <Skeleton key={i} className="h-3" style={{ width: w }} />
        ))}
      </div>
    </div>
  );
}

function CardRowsSkeleton({ rows, aside }: { rows: number; aside?: boolean }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card p-3.5 shadow-xs">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-3/4" />
          </div>
          {aside ? <Skeleton className="h-5 w-24" /> : null}
        </div>
      ))}
    </div>
  );
}

function OccupancySkeleton({ editable, month }: { editable: boolean; month: string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]" role="status" aria-label="Carregando disponibilidade">
      <div className="space-y-3">
        <CalendarSkeleton month={month} />
        {editable ? <Skeleton className="h-[62px] rounded-2xl" /> : null}
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <CardRowsSkeleton rows={3} />
      </div>
    </div>
  );
}

/** O que fazer com o período escolhido no calendário (substitui os botões soltos do topo). */
function RangeActions({
  range,
  days,
  conflicts,
  tariffConflicts,
  onTariff,
  onEditTariff,
  onSimulate,
  onBlock,
  onClear,
}: {
  range: { start: string | null; end: string | null };
  days: number;
  conflicts: Entity[];
  /** Tarifas que já cobrem alguma noite do período: uma noite só aceita uma tarifa. */
  tariffConflicts: Entity[];
  onTariff: () => void;
  onEditTariff: (row: Entity) => void;
  /** Sem permissão de cotar, o atalho não aparece. */
  onSimulate?: () => void;
  onBlock: () => void;
  onClear: () => void;
}) {
  const step = !range.start ? "idle" : !range.end ? "choosing" : "ready";
  const blocked = conflicts.length > 0;
  const tariffTaken = tariffConflicts.length > 0;

  if (step === "idle") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border/70 bg-muted/20 p-3.5 text-xs text-muted-foreground animate-in fade-in-0 duration-300">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <CalendarRange className="h-4 w-4" />
        </span>
        <p>
          Escolha um período no calendário para criar uma tarifa especial ou bloquear a agenda: clique no{" "}
          <strong className="font-medium text-foreground">primeiro dia</strong> e depois no{" "}
          <strong className="font-medium text-foreground">último</strong>.
        </p>
      </div>
    );
  }

  return (
    <div
      key={step}
      className="space-y-3 rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.06] to-transparent p-3.5 shadow-xs animate-in fade-in-0 slide-in-from-top-1 duration-300"
    >
      <div className="flex items-center gap-2">
        <DateChip label="Primeiro dia" date={range.start} />
        <ArrowRight className="h-4 w-4 shrink-0 text-primary/60" />
        <DateChip label="Último dia" date={range.end} placeholder="Escolha no calendário" />
      </div>

      {step === "choosing" ? (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Clique no último dia do período (pode ser o mesmo dia).</span>
          <Button type="button" variant="ghost" size="sm" className="h-7 rounded-full px-3 text-xs hover:cursor-pointer" onClick={onClear}>
            Cancelar
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
              {plural(days, "dia selecionado", "dias selecionados")}
            </span>
            <Button type="button" variant="ghost" size="sm" className="h-7 rounded-full px-3 text-xs text-muted-foreground hover:cursor-pointer" onClick={onClear}>
              <X className="h-3.5 w-3.5" />
              Limpar
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              className="h-10 justify-start gap-2 rounded-xl border-primary/30 bg-background text-xs font-semibold transition-all hover:-translate-y-px hover:cursor-pointer hover:border-primary/50 hover:shadow-sm disabled:translate-y-0"
              disabled={tariffTaken}
              onClick={onTariff}
            >
              <span className="grid h-6 w-6 place-items-center rounded-full bg-[#c9a96a]/20 text-[#8a682e]">
                <Coins className="h-3.5 w-3.5" />
              </span>
              Nova tarifa para o período
            </Button>
            <Button
              type="button"
              className="h-10 justify-start gap-2 rounded-xl text-xs font-semibold transition-all hover:-translate-y-px hover:cursor-pointer hover:shadow-md disabled:translate-y-0"
              disabled={blocked}
              onClick={onBlock}
            >
              <span className="grid h-6 w-6 place-items-center rounded-full bg-primary-foreground/20">
                <CalendarX className="h-3.5 w-3.5" />
              </span>
              Bloquear período
            </Button>
          </div>
          {onSimulate ? (
            <button
              type="button"
              onClick={onSimulate}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs font-medium text-primary transition-colors hover:cursor-pointer hover:bg-primary/5"
            >
              <Calculator className="h-3.5 w-3.5" />
              Simular estadia nessas datas ({plural(days, "noite", "noites")}, saída em {dateLabel(addDays(range.end!, 1))})
            </button>
          ) : null}
          {blocked ? (
            <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Não dá para bloquear: o período já tem{" "}
                {conflicts
                  .map((row) => {
                    const kind = (KINDS[kindOf(row)] ?? KINDS.BLOQUEIO).label.toLowerCase();
                    const id = row.reserva_id ? ` #${row.reserva_id}` : "";
                    return `${kind}${id}`;
                  })
                  .join(", ")}
                .{tariffTaken ? null : " A tarifa pode ser criada mesmo assim."}
              </span>
            </p>
          ) : null}
          {tariffTaken ? (
            <div className="flex flex-wrap items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                Não dá para criar outra tarifa: o período já tem {tariffConflicts.map((t) => `"${t.descricao || "Tarifa especial"}" (${dateLabel(t.inicio)} a ${dateLabel(addDays(t.fim, -1))})`).join(", ")}. Cada noite
                aceita uma tarifa só.
              </span>
              {tariffConflicts.length === 1 ? (
                <button
                  type="button"
                  onClick={() => onEditTariff(tariffConflicts[0])}
                  className="shrink-0 font-semibold underline underline-offset-2 hover:cursor-pointer"
                >
                  Editar essa tarifa
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Confirmação de liberar bloqueio / excluir tarifa, com o período e o efeito à vista. */
function ConfirmRemoval({
  target,
  busy,
  onCancel,
  onConfirm,
}: {
  target: { kind: "block" | "tariff"; row: Entity } | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const row = target?.row;
  const isBlock = target?.kind === "block";
  const kind = row ? KINDS[kindOf(row)] ?? KINDS.BLOQUEIO : null;
  return (
    <AlertDialog open={Boolean(target)} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{isBlock ? "Liberar este período?" : "Excluir esta tarifa?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {isBlock
              ? "Os dias voltam a ficar disponíveis para novas reservas, no site e no ERP."
              : "As próximas cotações voltam a usar a diária padrão do imóvel nessas noites. Reservas já feitas não mudam."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {row ? (
          <div className="rounded-xl border border-border/60 bg-muted/30 px-3.5 py-3 text-sm">
            {isBlock ? (
              <>
                <p className="flex items-center gap-2 font-medium text-foreground">
                  <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", kind?.dot)} />
                  {kind?.label}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{periodText(row)}</p>
                {row.motivo ? <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{row.motivo}</p> : null}
              </>
            ) : (
              <>
                <p className="font-medium text-foreground">{row.descricao || "Tarifa especial"}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {dateLabel(row.inicio)} a {dateLabel(addDays(row.fim, -1))} · {money(row.diaria)} / noite
                </p>
              </>
            )}
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} className="hover:cursor-pointer">
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(event) => {
              // Mantém aberto até a exclusão terminar (o padrão fecha no clique).
              event.preventDefault();
              onConfirm();
            }}
            className={cn(
              "gap-2 hover:cursor-pointer",
              !isBlock && "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            )}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : isBlock ? <CalendarCheck className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
            {isBlock ? "Liberar período" : "Excluir tarifa"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type BlockForm = { inicio: string; ultimo: string; motivo: string; tipo: "BLOQUEIO" | "MANUTENCAO" };
type TariffForm = {
  id?: number;
  inicio: string;
  ultima: string;
  diaria: number | null;
  min_noites: number;
  descricao: string;
  /** Pacote fechado: estadias com noite nesta tarifa precisam caber inteiras no período. */
  reserva_exclusiva: boolean;
};

/** Situação da reserva: cor e ícone por estado, legível de relance. */
const OPERATION_STATUS: Record<string, { label: string; icon: React.ElementType; className: string; pulse?: boolean }> = {
  CONFIRMADA: { label: "Confirmada", icon: CalendarCheck, className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  EM_ANDAMENTO: { label: "Hospedado", icon: DoorOpen, className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", pulse: true },
  CONCLUIDA: { label: "Concluída", icon: CheckCircle2, className: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300" },
  CANCELADA: { label: "Cancelada", icon: XCircle, className: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300" },
};

/** Situação do pagamento da reserva. */
const PAYMENT_STATUS: Record<string, { label: string; icon: React.ElementType; className: string }> = {
  PAGO: { label: "Pago", icon: CheckCircle2, className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  PARCIAL: { label: "Pago em parte", icon: CircleDashed, className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  PENDENTE: { label: "A receber", icon: Clock3, className: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300" },
  ESTORNADO: { label: "Estornado", icon: Undo2, className: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300" },
};

function Pill({
  config,
  fallback,
}: {
  config?: { label: string; icon: React.ElementType; className: string; pulse?: boolean };
  fallback: string;
}) {
  const Icon = config?.icon ?? Clock3;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        config?.className ?? "border-border bg-muted text-muted-foreground"
      )}
    >
      {config?.pulse ? (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      ) : (
        <Icon className="h-3 w-3 shrink-0" />
      )}
      {config?.label ?? fallback}
    </span>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

/**
 * Reserva do mês: quem está, quanto vale, em que situação, e o atalho para abrir.
 * Hóspede e valor só chegam para quem pode ver reservas; sem eles, fica o período.
 */
function OperationCard({
  row,
  kind,
  onOpen,
}: {
  row: Entity;
  kind: { label: string; dot: string };
  onOpen?: (kind: "reservas", id: number) => void;
}) {
  const operacao: Entity | null = row.reserva ?? null;
  const id = Number(row.reserva_id);
  const pessoa: string | undefined = operacao?.cliente?.nomerazaosocial;
  const valor = operacao?.valor_total;
  const status = String(operacao?.status ?? "");
  const pagamento = String(operacao?.financeiro_status ?? "");
  const abrir = onOpen && operacao ? () => onOpen("reservas", id) : undefined;
  // Reserva do Airbnb cadastrada sozinha: hóspede e valores chegam depois, pelo operador.
  const hospedeAIdentificar = operacao?.cliente?.codigo_sistema === "hospede_airbnb";
  const quantidadeAConfirmar = hospedesAConfirmar(operacao);
  const valorAInformar = operacao?.origem === "AIRBNB" && Number(valor ?? 0) <= 0;
  const pendencias = [
    hospedeAIdentificar ? "hóspede" : null,
    quantidadeAConfirmar ? "nº de hóspedes" : null,
    valorAInformar ? "valores" : null,
  ].filter(Boolean);
  // Mesma cor da faixa da reserva no calendário.
  const accent =
    status === "EM_ANDAMENTO" ? "before:bg-[#3f7d5c]" : status === "CONCLUIDA" ? "before:bg-[#8d969c]" : "before:bg-[#2f6684]";
  const avatar = "bg-sky-500/10 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300";

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border/60 bg-card p-4 pl-5 shadow-xs transition-all duration-200",
        "before:absolute before:inset-y-0 before:left-0 before:w-1",
        accent,
        abrir && "hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md",
        status === "CANCELADA" && "opacity-75"
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold", avatar)}>
          {pessoa ? initials(pessoa) : <User className="h-4 w-4" />}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{pessoa ?? `${kind.label} #${id}`}</p>
              <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                <span className="font-mono">
                  {kind.label} #{id}
                </span>
                {row.calendario_codigo ? (
                  <span className="inline-flex items-center gap-1">
                    · Airbnb <AirbnbCodeLink codigo={String(row.calendario_codigo)} />
                  </span>
                ) : null}
                {quantidadeAConfirmar ? (
                  <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300" title="O Airbnb não informa quantos hóspedes são">
                    · <Users className="h-3 w-3" /> hóspedes a confirmar
                  </span>
                ) : operacao?.hospedes ? (
                  <span className="inline-flex items-center gap-1">
                    · <Users className="h-3 w-3" /> {plural(Number(operacao.hospedes), "hóspede", "hóspedes")}
                  </span>
                ) : null}
              </p>
            </div>
            {valorAInformar ? (
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold leading-tight text-amber-700 dark:text-amber-300">A informar</p>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Total</p>
              </div>
            ) : valor != null ? (
              <div className="shrink-0 text-right">
                <p className="text-base font-bold leading-tight tabular-nums text-foreground">{money(valor)}</p>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Total</p>
              </div>
            ) : null}
          </div>

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarRange className="h-3.5 w-3.5 shrink-0" />
            <span>{periodText(row)}</span>
          </p>
        </div>
      </div>

      {status || pagamento || abrir ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-3">
          {status ? <Pill config={OPERATION_STATUS[status]} fallback={status} /> : null}
          {pagamento && !valorAInformar ? <Pill config={PAYMENT_STATUS[pagamento]} fallback={pagamento} /> : null}
          {pendencias.length ? (
            <Pill
              config={{
                label: `Completar: ${pendencias.join(", ")}`,
                icon: AlertTriangle,
                className: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
              }}
              fallback=""
            />
          ) : null}
          {abrir ? (
            <button
              type="button"
              onClick={abrir}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full bg-primary/10 px-3.5 text-xs font-semibold text-primary transition-all duration-200 hover:cursor-pointer hover:bg-primary hover:text-primary-foreground hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97]"
            >
              Abrir reserva
              <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Reserva que chegou pelo calendário do Airbnb e ainda não foi registrada no ERP: período, código
 * (abre no Airbnb) e o atalho para registrá-la com hóspede e valores.
 */
function AirbnbReservationCard({ row, onRegister }: { row: Entity; onRegister?: (row: Entity) => void }) {
  const codigo = row.calendario_codigo ? String(row.calendario_codigo) : null;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-dashed border-[#e0565b]/40 bg-card p-4 pl-5 shadow-xs before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-[#e0565b]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-[#e0565b]" />
            Reserva Airbnb
            {codigo ? <AirbnbCodeLink codigo={codigo} /> : null}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarRange className="h-3.5 w-3.5 shrink-0" />
            <span>{periodText(row)}</span>
          </p>
          <p className="text-[11px] text-muted-foreground">
            {codigo
              ? "Não está no ERP: já tinha terminado na primeira leitura ou não pôde ser cadastrada sozinha."
              : "O Airbnb não informou o código desta reserva; não dá para registrá-la no ERP."}
          </p>
        </div>
        {codigo && onRegister ? (
          <Button
            type="button"
            size="sm"
            onClick={() => onRegister(row)}
            className="h-8 shrink-0 gap-1.5 rounded-full text-xs hover:cursor-pointer"
          >
            <CalendarCheck className="h-3.5 w-3.5" />
            Registrar no ERP
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function AvailabilityPanel({
  item,
  editable,
  onOpenOperation,
  onRegisterAirbnb,
  versao = 0,
}: {
  item: Entity;
  editable: boolean;
  /** Abre o diálogo da reserva a partir da lista do mês. */
  onOpenOperation?: (kind: "reservas", id: number) => void;
  /** Abre uma reserva nova já com o imóvel, as datas e o código do evento do Airbnb. */
  onRegisterAirbnb?: (row: Entity) => void;
  /** Muda quando uma operação aberta daqui é salva: recarrega sem perder o mês exibido. */
  versao?: number;
}) {
  const { can } = useModulePermission();
  const remote = useRemote(`/api/imoveis/${item.id}/disponibilidade`);
  const recarregarOcupacao = remote.reload;
  useEffect(() => {
    if (versao) recarregarOcupacao();
  }, [versao, recarregarOcupacao]);
  const rates = useRemote(`/api/imoveis/${item.id}/tarifas`);
  const [month, setMonth] = useState(() => monthStart(todayCivil()));
  const [busy, setBusy] = useState(false);
  const [block, setBlock] = useState<BlockForm | null>(null);
  const [tariff, setTariff] = useState<TariffForm | null>(null);
  const [range, setRange] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [simulation, setSimulation] = useState<SimulationRequest | null>(null);
  const [confirming, setConfirming] = useState<{ kind: "block" | "tariff"; row: Entity } | null>(null);
  const [removing, setRemoving] = useState(false);
  const canSimulate = can("reservas:criar");

  const rows: Entity[] = remote.data?.items ?? [];
  const tariffs: Entity[] = useMemo(
    () => [...(rates.data?.items ?? [])].sort((a: Entity, b: Entity) => String(a.inicio).localeCompare(String(b.inicio))),
    [rates.data]
  );
  const monthEnd = monthStart(addDays(month, 32));
  // Períodos que tocam o mês visível (o calendário substitui a lista de tudo, inclusive o passado).
  const monthRows = rows
    .filter((row) => row.inicio < monthEnd && (!row.fim || row.fim > month))
    .sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));

  const failure = (title: string, error: unknown) => toast.error(title, { description: (error as Error).message });

  // 1º clique: início. 2º clique: fim (antes do início, vira o novo início). Com o período fechado, recomeça.
  const pickDay = (day: string) =>
    setRange((current) =>
      !current.start || current.end || day < current.start ? { start: day, end: null } : { start: current.start, end: day }
    );
  const clearRange = () => setRange({ start: null, end: null });
  const rangeDays = range.start && range.end ? daysBetween(range.start, range.end) + 1 : 0;
  const rangeTariffs =
    range.start && range.end
      ? tariffs.filter((t) => t.ativo !== false && t.inicio <= range.end! && t.fim > range.start!)
      : [];
  // Bloqueio não pode cobrir dia já ocupado (o banco recusa); tarifa pode, vale para reservas futuras.
  const rangeConflicts =
    range.start && range.end
      ? rows.filter((row) => row.inicio <= range.end! && (!row.fim || row.fim > range.start!))
      : [];

  const saveBlock = async () => {
    if (!block) return;
    if (block.ultimo < block.inicio) return toast.error("O último dia deve ser igual ou posterior ao primeiro.");
    if (block.motivo.trim().length < 3) return toast.error("Informe o motivo do bloqueio (mínimo 3 caracteres).");
    setBusy(true);
    try {
      await requestJson(`/api/imoveis/${item.id}/bloqueios`, {
        method: "POST",
        body: JSON.stringify({ inicio: block.inicio, fim: addDays(block.ultimo, 1), motivo: block.motivo.trim(), tipo: block.tipo }),
      });
      toast.success(block.tipo === "MANUTENCAO" ? "Manutenção registrada" : "Período bloqueado");
      setBlock(null);
      clearRange();
      remote.reload();
    } catch (error) {
      failure("Não foi possível bloquear o período", error);
    } finally {
      setBusy(false);
    }
  };

  const removeBlock = async (row: Entity) => {
    try {
      await requestJson(`/api/imoveis/${item.id}/bloqueios/${row.bloqueio_id ?? row.id}`, { method: "DELETE" });
      remote.reload();
      toast.success("Bloqueio removido");
    } catch (error) {
      failure("Não foi possível remover o bloqueio", error);
    }
  };

  const saveTariff = async () => {
    if (!tariff) return;
    if (tariff.ultima < tariff.inicio) return toast.error("A última noite deve ser igual ou posterior à primeira.");
    if (!tariff.diaria || tariff.diaria <= 0) return toast.error("Informe o valor da diária.");
    setBusy(true);
    try {
      const body = JSON.stringify({
        inicio: tariff.inicio,
        fim: addDays(tariff.ultima, 1),
        diaria: tariff.diaria,
        min_noites: tariff.min_noites || 1,
        descricao: tariff.descricao.trim() || null,
        reserva_exclusiva: tariff.reserva_exclusiva,
      });
      await requestJson(`/api/imoveis/${item.id}/tarifas${tariff.id ? `/${tariff.id}` : ""}`, {
        method: tariff.id ? "PATCH" : "POST",
        body,
      });
      toast.success(tariff.id ? "Tarifa atualizada" : "Tarifa registrada");
      setTariff(null);
      if (!tariff.id) clearRange();
      rates.reload();
    } catch (error) {
      failure("Não foi possível salvar a tarifa", error);
    } finally {
      setBusy(false);
    }
  };

  const removeTariff = async (row: Entity) => {
    try {
      await requestJson(`/api/imoveis/${item.id}/tarifas/${row.id}`, { method: "DELETE" });
      rates.reload();
      toast.success("Tarifa excluída");
    } catch (error) {
      failure("Não foi possível excluir a tarifa", error);
    }
  };

  const editTariff = (row: Entity) =>
    setTariff({
      id: Number(row.id),
      inicio: row.inicio,
      ultima: addDays(row.fim, -1),
      diaria: Number(row.diaria),
      min_noites: Number(row.min_noites ?? 1),
      descricao: row.descricao ?? "",
      reserva_exclusiva: Boolean(row.reserva_exclusiva),
    });
  const newBlock = (start: string, last: string) => setBlock({ inicio: start, ultimo: last, motivo: "", tipo: "BLOQUEIO" });
  const newTariff = (start: string, last: string) =>
    setTariff({
      inicio: start,
      ultima: last,
      diaria: Number(item.diaria) || null,
      min_noites: Number(item.min_noites) || 1,
      descricao: "",
      reserva_exclusiva: false,
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm sm:text-base text-foreground">Disponibilidade e Tarifário</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ocupação do imóvel mês a mês, bloqueios de agenda e diárias especiais por período.
          </p>
        </div>
      </div>

      <section className="space-y-3">
        <h4 className="font-semibold text-xs sm:text-sm text-foreground flex items-center gap-2">
          <CalendarCheck className="h-4 w-4 text-primary" />
          Calendário de ocupação
        </h4>
        {!remote.data && remote.error ? (
          <RemoteState error={remote.error} retry={remote.reload} />
        ) : !remote.data ? (
          <OccupancySkeleton editable={editable} month={month} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              <OccupancyCalendar
                month={month}
                onMonth={setMonth}
                rows={rows}
                tariffs={tariffs}
                selection={editable ? range : undefined}
                onDayClick={editable ? pickDay : undefined}
                checkinTime={item.horario_checkin}
                checkoutTime={item.horario_checkout}
                onOpenReservation={onOpenOperation ? (id) => onOpenOperation("reservas", id) : undefined}
              />
              {editable ? (
                <RangeActions
                  range={range}
                  days={rangeDays}
                  conflicts={rangeConflicts}
                  tariffConflicts={rangeTariffs}
                  onTariff={() => range.start && range.end && newTariff(range.start, range.end)}
                  onEditTariff={editTariff}
                  // Dias escolhidos = noites da estadia: saída no dia seguinte ao último.
                  onSimulate={
                    canSimulate
                      ? () => range.start && range.end && setSimulation({ inicio: range.start, fim: addDays(range.end, 1), nonce: Date.now() })
                      : undefined
                  }
                  onBlock={() => range.start && range.end && newBlock(range.start, range.end)}
                  onClear={clearRange}
                />
              ) : null}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {monthRows.length ? `Períodos neste mês (${monthRows.length})` : "Nenhum período ocupado ou bloqueado neste mês."}
              </p>
              {monthRows.map((row, index) => {
                const kind = KINDS[kindOf(row)] ?? KINDS.BLOQUEIO;
                if (!isBlock(row) && row.reserva_id) {
                  return (
                    <OperationCard
                      key={row.id ?? index}
                      row={row}
                      kind={kind}
                      onOpen={onOpenOperation}
                    />
                  );
                }
                if (row.canal_calendario_id && row.calendario_tipo === "RESERVA") {
                  return <AirbnbReservationCard key={row.id ?? index} row={row} onRegister={onRegisterAirbnb} />;
                }
                return (
                  <div key={row.id ?? index} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card p-3.5 shadow-xs">
                    <div className="min-w-0 space-y-1">
                      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", kind.dot)} />
                        {kind.label}
                        {row.reserva_id ? ` · Reserva #${row.reserva_id}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">{periodText(row)}</p>
                      {row.motivo ? <p className="text-xs text-muted-foreground line-clamp-2">{row.motivo}</p> : null}
                    </div>
                    {editable && isBlock(row) && !row.canal_calendario_id ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive gap-1 hover:cursor-pointer"
                        onClick={() => setConfirming({ kind: "block", row })}
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>Liberar</span>
                      </Button>
                    ) : row.status ? (
                      <StatusBadge status={row.status} />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h4 className="font-semibold text-xs sm:text-sm text-foreground flex items-center gap-2">
          <Coins className="h-4 w-4 text-primary" />
          Tarifas por período
        </h4>
        <p className="text-xs text-muted-foreground">
          Fora destes períodos vale a diária padrão do imóvel ({money(item.diaria)} / noite, mínimo de{" "}
          {plural(Number(item.min_noites) || 1, "noite", "noites")}).
        </p>
        {!rates.data && rates.error ? (
          <RemoteState error={rates.error} retry={rates.reload} />
        ) : !rates.data ? (
          <CardRowsSkeleton rows={2} aside />
        ) : !tariffs.length ? (
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-border/70 bg-muted/20 p-3.5 text-xs text-muted-foreground">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#c9a96a]/15 text-[#8a682e]">
              <Coins className="h-4 w-4" />
            </span>
            <p>
              Nenhuma tarifa especial: todas as noites usam a diária padrão.
              {editable ? " Escolha um período no calendário para criar uma." : ""}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {tariffs.map((row) => {
              const last = addDays(row.fim, -1);
              return (
                <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card p-3.5 text-sm shadow-xs">
                  <div className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5 font-medium text-foreground">
                      {row.descricao || "Tarifa especial"}
                      {row.reserva_exclusiva ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-300">
                          <Lock className="h-3 w-3" />
                          Pacote fechado
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {dateLabel(row.inicio)} a {dateLabel(last)} · {plural(daysBetween(row.inicio, row.fim), "noite", "noites")} · mínimo de{" "}
                      {plural(Number(row.min_noites ?? 1), "noite", "noites")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <strong className="text-base font-bold text-primary">
                      {money(row.diaria)} <span className="text-xs font-normal text-muted-foreground">/ noite</span>
                    </strong>
                    {editable ? (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 hover:cursor-pointer"
                          aria-label="Editar tarifa"
                          onClick={() => editTariff(row)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive hover:cursor-pointer"
                          aria-label="Excluir tarifa"
                          onClick={() => setConfirming({ kind: "tariff", row })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {canSimulate ? <QuoteSimulator item={item} tariffs={tariffs} request={simulation} /> : null}

      <ConfirmRemoval
        target={confirming}
        busy={removing}
        onCancel={() => !removing && setConfirming(null)}
        onConfirm={async () => {
          if (!confirming) return;
          setRemoving(true);
          try {
            await (confirming.kind === "block" ? removeBlock(confirming.row) : removeTariff(confirming.row));
          } finally {
            setRemoving(false);
            setConfirming(null);
          }
        }}
      />

      {block ? (
        <BlockDialog form={block} onChange={setBlock} rows={rows} busy={busy} onSave={saveBlock} onClose={() => !busy && setBlock(null)} />
      ) : null}

      {tariff ? (
        <TariffDialog
          form={tariff}
          onChange={setTariff}
          tariffs={tariffs}
          item={item}
          busy={busy}
          onSave={saveTariff}
          onClose={() => !busy && setTariff(null)}
        />
      ) : null}
    </div>
  );
}

/* ───────────── Diálogos de bloqueio e tarifa ───────────── */

/** Por fora: tira o p-6 padrão do DialogContent; por dentro, o conteúdo rola e tem respiro. */
const DIALOG_CLASS = "flex max-h-[90vh] w-[95vw] max-w-xl flex-col gap-0 overflow-hidden p-0";

function DialogBody({ children }: { children: React.ReactNode }) {
  return <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6">{children}</div>;
}

function SectionLabel({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</span>
      {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

function SuggestionChips({ options, value, onPick }: { options: string[]; value: string; onPick: (value: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = value.trim().toLocaleLowerCase("pt-BR") === option.toLocaleLowerCase("pt-BR");
        return (
          <button
            key={option}
            type="button"
            onClick={() => onPick(option)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors duration-150 hover:cursor-pointer",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border/70 bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

/** Resumo do período escolhido no calendário; as datas só abrem para ajuste se pedido. */
function PeriodSummary({
  start,
  last,
  unit,
  startLabel,
  lastLabel,
  onChange,
}: {
  start: string;
  last: string;
  unit: "dias" | "noites";
  startLabel: string;
  lastLabel: string;
  onChange: (start: string, last: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const count = last >= start ? daysBetween(start, last) + 1 : 0;
  return (
    <div className="rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/[0.06] to-transparent p-3.5">
      <div className="flex items-center gap-2">
        <DateChip label={startLabel} date={start} />
        <ArrowRight className="h-4 w-4 shrink-0 text-primary/60" />
        <DateChip label={lastLabel} date={last} />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
          {unit === "dias" ? plural(count, "dia", "dias") : plural(count, "noite", "noites")}
        </span>
        <button
          type="button"
          onClick={() => setEditing((current) => !current)}
          className="text-xs font-medium text-primary hover:underline hover:cursor-pointer"
        >
          {editing ? "Ocultar datas" : "Ajustar datas"}
        </button>
      </div>
      {editing ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 animate-in fade-in-0 slide-in-from-top-1 duration-200">
          <Field label={startLabel}>
            <DatePicker
              value={start}
              aria-label={startLabel}
              onChange={(value) => value && onChange(value, last < value ? value : last)}
              className="h-10 rounded-xl bg-background"
            />
          </Field>
          <Field label={lastLabel}>
            <DatePicker
              value={last}
              min={start}
              aria-label={lastLabel}
              onChange={(value) => value && onChange(start, value)}
              className="h-10 rounded-xl bg-background"
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

function ShellFooter({
  busy,
  disabled,
  onCancel,
  onSave,
  label,
  icon,
}: {
  busy: boolean;
  disabled?: boolean;
  onCancel: () => void;
  onSave: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex w-full items-center justify-end gap-2">
      <Button variant="ghost" onClick={onCancel} disabled={busy} className="h-10 rounded-xl text-sm hover:cursor-pointer">
        Cancelar
      </Button>
      <Button onClick={onSave} disabled={busy || disabled} className="h-10 min-w-36 gap-2 rounded-xl text-sm font-semibold hover:cursor-pointer">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
        {label}
      </Button>
    </div>
  );
}

const BLOCK_REASONS = ["Uso do proprietário", "Reforma", "Pintura", "Limpeza pesada", "Vistoria", "Reparo elétrico/hidráulico"];

function BlockDialog({
  form,
  onChange,
  rows,
  busy,
  onSave,
  onClose,
}: {
  form: BlockForm;
  onChange: (form: BlockForm) => void;
  rows: Entity[];
  busy: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  // Ajustar as datas no diálogo pode cair em dia ocupado: o banco recusaria, então avisa antes.
  const conflicts = rows.filter((row) => row.inicio <= form.ultimo && (!row.fim || row.fim > form.inicio));
  const types = [
    { value: "BLOQUEIO" as const, title: "Bloqueio", text: "Agenda fechada: uso do proprietário, compromisso ou outro motivo.", icon: CalendarX },
    { value: "MANUTENCAO" as const, title: "Manutenção", text: "Obra ou reparo: o imóvel aparece como em manutenção.", icon: Wrench },
  ];

  return (
    <EntityShell
      open
      onOpenChange={(open) => !open && onClose()}
      title="Bloquear período"
      description="Os dias escolhidos ficam indisponíveis para novas reservas."
      className={DIALOG_CLASS}
      footer={
        <ShellFooter
          busy={busy}
          disabled={conflicts.length > 0 || form.motivo.trim().length < 3}
          onCancel={onClose}
          onSave={onSave}
          label={form.tipo === "MANUTENCAO" ? "Registrar manutenção" : "Bloquear período"}
          icon={<CalendarX className="h-4 w-4" />}
        />
      }
    >
      <DialogBody>
        <PeriodSummary
          start={form.inicio}
          last={form.ultimo}
          unit="dias"
          startLabel="Primeiro dia"
          lastLabel="Último dia"
          onChange={(inicio, ultimo) => onChange({ ...form, inicio, ultimo })}
        />

        {conflicts.length ? (
          <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              O período já tem {conflicts.map((row) => `${(KINDS[kindOf(row)] ?? KINDS.BLOQUEIO).label.toLowerCase()} (${periodText(row)})`).join("; ")}. Ajuste as datas
              para bloquear.
            </span>
          </p>
        ) : null}

        <div>
          <SectionLabel>Tipo</SectionLabel>
          <div role="radiogroup" aria-label="Tipo de bloqueio" className="grid gap-2 sm:grid-cols-2">
            {types.map((type) => {
              const selected = form.tipo === type.value;
              return (
                <button
                  key={type.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onChange({ ...form, tipo: type.value })}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3 text-left transition-all duration-150 hover:cursor-pointer",
                    selected ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30" : "border-border/60 hover:border-primary/30 hover:bg-muted/30"
                  )}
                >
                  <span
                    className={cn(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors",
                      selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}
                  >
                    <type.icon className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-foreground">{type.title}</span>
                    <span className="block text-xs text-muted-foreground">{type.text}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <SectionLabel hint={`${form.motivo.trim().length}/2000`}>Motivo</SectionLabel>
          <SuggestionChips options={BLOCK_REASONS} value={form.motivo} onPick={(motivo) => onChange({ ...form, motivo })} />
          <Textarea
            placeholder="Descreva o motivo (mínimo 3 caracteres)"
            value={form.motivo}
            maxLength={2000}
            onChange={(e) => onChange({ ...form, motivo: e.target.value })}
            className="mt-2 rounded-xl text-base sm:text-sm"
            rows={3}
          />
        </div>

        {form.ultimo >= form.inicio ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarCheck className="h-3.5 w-3.5 shrink-0 text-primary" />O imóvel volta a ficar disponível em{" "}
            <strong className="font-semibold capitalize text-foreground">{shortDay(addDays(form.ultimo, 1))}</strong>.
          </p>
        ) : null}
      </DialogBody>
    </EntityShell>
  );
}

/** Opção "reservas só dentro do período": explica com as datas reais o que o hóspede poderá reservar. */
function ExclusiveOption({ form, nights, onChange }: { form: TariffForm; nights: number; onChange: (form: TariffForm) => void }) {
  const checkout = addDays(form.ultima, 1);
  const tooShort = form.reserva_exclusiva && nights > 0 && form.min_noites > nights;
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors duration-150",
        form.reserva_exclusiva ? "border-violet-500/40 bg-violet-500/5" : "border-border/60 hover:border-primary/30 hover:bg-muted/30"
      )}
    >
      <Checkbox
        checked={form.reserva_exclusiva}
        onCheckedChange={(checked) => onChange({ ...form, reserva_exclusiva: checked === true })}
        className="mt-0.5"
      />
      <span className="min-w-0 space-y-1">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Lock className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
          Reservas só dentro deste período
        </span>
        <span className="block text-xs text-muted-foreground">
          Pacote fechado, o hóspede só reserva com entrada e saída entre{" "}
          <strong className="font-medium capitalize text-foreground">{shortDay(form.inicio)}</strong> e{" "}
          <strong className="font-medium capitalize text-foreground">{shortDay(checkout)}</strong>
          {form.min_noites > 1 ? `, com no mínimo ${plural(form.min_noites, "noite", "noites")}` : ""}. Estadias que começam antes ou
          terminam depois são recusadas no site e no ERP.
        </span>
        {tooShort ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />O mínimo de noites é maior que o período ({plural(nights, "noite", "noites")}): nenhuma
            reserva seria possível.
          </span>
        ) : null}
      </span>
    </label>
  );
}

const TARIFF_NAMES = ["Alta temporada", "Baixa temporada", "Réveillon", "Carnaval", "Feriado prolongado", "Férias escolares"];
const TARIFF_STEPS = [-10, 10, 20, 30, 50];

function TariffDialog({
  form,
  onChange,
  tariffs,
  item,
  busy,
  onSave,
  onClose,
}: {
  form: TariffForm;
  onChange: (form: TariffForm) => void;
  tariffs: Entity[];
  item: Entity;
  busy: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const base = Number(item.diaria) || 0;
  const nights = form.ultima >= form.inicio ? daysBetween(form.inicio, form.ultima) + 1 : 0;
  const diff = base > 0 && form.diaria ? Math.round(((form.diaria - base) / base) * 100) : null;
  const fim = addDays(form.ultima, 1);
  // Uma noite aceita uma tarifa só (o banco também recusa); ao ajustar datas, avisa antes de salvar.
  const overlaps = tariffs.filter((t) => Number(t.id) !== form.id && t.ativo !== false && t.inicio < fim && t.fim > form.inicio);

  return (
    <EntityShell
      open
      onOpenChange={(open) => !open && onClose()}
      title={form.id ? "Editar tarifa" : "Nova tarifa"}
      description="As cotações usam esta diária para as noites dentro do período."
      className={DIALOG_CLASS}
      footer={
        <ShellFooter
          busy={busy}
          disabled={!form.diaria || form.diaria <= 0 || nights < 1 || overlaps.length > 0}
          onCancel={onClose}
          onSave={onSave}
          label={form.id ? "Salvar alterações" : "Criar tarifa"}
          icon={<Coins className="h-4 w-4" />}
        />
      }
    >
      <DialogBody>
        <PeriodSummary
          start={form.inicio}
          last={form.ultima}
          unit="noites"
          startLabel="Primeira noite"
          lastLabel="Última noite"
          onChange={(inicio, ultima) => onChange({ ...form, inicio, ultima })}
        />

        <div>
          <SectionLabel>Nome da tarifa</SectionLabel>
          <SuggestionChips options={TARIFF_NAMES} value={form.descricao} onPick={(descricao) => onChange({ ...form, descricao })} />
          <Input
            maxLength={200}
            placeholder="Ou escreva um nome, ex: Semana do Natal"
            value={form.descricao}
            onChange={(e) => onChange({ ...form, descricao: e.target.value })}
            className="mt-2 h-10 rounded-xl text-base sm:text-sm"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <SectionLabel hint={base > 0 ? `Padrão: ${money(base)}` : undefined}>Diária no período</SectionLabel>
            <ValueInput
              placeholder="R$ 0,00"
              value={form.diaria}
              onValueChange={(val) => onChange({ ...form, diaria: val })}
              onEmpty={() => onChange({ ...form, diaria: null })}
              className="h-12 rounded-xl text-lg font-semibold"
            />
            {base > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {TARIFF_STEPS.map((step) => (
                  <button
                    key={step}
                    type="button"
                    onClick={() => onChange({ ...form, diaria: Math.round(base * (1 + step / 100) * 100) / 100 })}
                    className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:cursor-pointer hover:border-primary/40 hover:text-foreground"
                  >
                    {step > 0 ? `+${step}%` : `${step}%`}
                  </button>
                ))}
                {diff != null && diff !== 0 ? (
                  <span
                    className={cn(
                      "ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      diff > 0 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-rose-500/10 text-rose-700 dark:text-rose-400"
                    )}
                  >
                    {diff > 0 ? `+${diff}%` : `${diff}%`} da padrão
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div>
            <SectionLabel>Mínimo de noites</SectionLabel>
            <div className="flex h-12 items-center rounded-xl border border-input bg-background">
              <button
                type="button"
                aria-label="Menos uma noite"
                disabled={form.min_noites <= 1}
                onClick={() => onChange({ ...form, min_noites: Math.max(1, form.min_noites - 1) })}
                className="grid h-full w-11 place-items-center rounded-l-xl text-lg text-muted-foreground transition-colors hover:cursor-pointer hover:bg-muted disabled:cursor-default disabled:opacity-40"
              >
                −
              </button>
              <span className="w-10 text-center text-base font-semibold tabular-nums">{form.min_noites}</span>
              <button
                type="button"
                aria-label="Mais uma noite"
                disabled={form.min_noites >= 365}
                onClick={() => onChange({ ...form, min_noites: Math.min(365, form.min_noites + 1) })}
                className="grid h-full w-11 place-items-center rounded-r-xl text-lg text-muted-foreground transition-colors hover:cursor-pointer hover:bg-muted disabled:cursor-default disabled:opacity-40"
              >
                +
              </button>
            </div>
          </div>
        </div>

        <ExclusiveOption form={form} nights={nights} onChange={onChange} />

        {form.diaria && nights > 0 ? (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3.5 py-3 text-sm">
            <span className="text-muted-foreground">
              {plural(nights, "noite", "noites")} × {money(form.diaria)}
            </span>
            <span className="text-right">
              <strong className="block text-base tabular-nums text-foreground">{money(nights * form.diaria)}</strong>
              <span className="text-[11px] text-muted-foreground">sem a taxa de limpeza</span>
            </span>
          </div>
        ) : null}

        {overlaps.length ? (
          <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Essas datas já têm {overlaps.map((t) => `"${t.descricao || "Tarifa especial"}" (${dateLabel(t.inicio)} a ${dateLabel(addDays(t.fim, -1))})`).join(", ")}. Cada noite aceita uma
              tarifa só: ajuste as datas ou edite a tarifa existente.
            </span>
          </p>
        ) : null}
      </DialogBody>
    </EntityShell>
  );
}

type SimulationRequest = { inicio: string; fim: string; nonce: number };
type NightGroup = { key: string; from: string; to: string; count: number; amount: number; label: string; special: boolean; exclusive: boolean };

/** Noites seguidas com a mesma tarifa e o mesmo valor viram uma linha só. */
function groupNights(nights: { date: string; amount: number }[], tariffs: Entity[]) {
  const groups: NightGroup[] = [];
  for (const night of nights) {
    const tariff = tariffs.find((t) => t.ativo !== false && covers(t, night.date));
    const key = `${tariff?.id ?? "base"}-${night.amount}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key && addDays(last.to, 1) === night.date) {
      last.to = night.date;
      last.count += 1;
      continue;
    }
    groups.push({
      key,
      from: night.date,
      to: night.date,
      count: 1,
      amount: night.amount,
      label: tariff ? tariff.descricao || "Tarifa especial" : "Diária padrão",
      special: Boolean(tariff),
      exclusive: Boolean(tariff?.reserva_exclusiva),
    });
  }
  return groups;
}

/** Mesma cotação da reserva: diárias noite a noite (com tarifas), taxa de limpeza e total. */
function QuoteSimulator({ item, tariffs, request }: { item: Entity; tariffs: Entity[]; request: SimulationRequest | null }) {
  const today = todayCivil();
  // O maior entre o mínimo geral (Configurações > Geral) e o do imóvel; tarifas aparecem na simulação.
  const minimoGeral = Number(useConfig()?.reserva_min_noites) || 1;
  const minNights = Math.max(1, Number(item.min_noites) || 1, minimoGeral);
  const capacity = Math.max(1, Number(item.capacidade) || 1);
  const [form, setForm] = useState({ inicio: today, fim: addDays(today, minNights), hospedes: 1 });
  const [loading, setLoading] = useState(false);
  const [quote, setQuote] = useState<Entity | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const section = useRef<HTMLElement>(null);
  const nightsCount = form.fim > form.inicio ? daysBetween(form.inicio, form.fim) : 0;

  // Datas mudaram: o resultado anterior não vale mais para o que está na tela.
  const change = (next: typeof form) => {
    setForm(next);
    setQuote(null);
    setRefusal(null);
  };

  const simulate = async (values = form) => {
    if (!values.inicio || !values.fim || values.fim <= values.inicio) return toast.error("A saída deve ser depois da entrada.");
    setLoading(true);
    setQuote(null);
    setRefusal(null);
    setDetails(false);
    try {
      const params = new URLSearchParams({ inicio: values.inicio, fim: values.fim, hospedes: String(values.hospedes) });
      setQuote(await requestJson(`/api/imoveis/${item.id}/cotacao?${params}`));
    } catch (error) {
      const failure = error as Error & { status?: number };
      // Regra da cotação (mínimo de noites, pacote fechado, hóspedes): é o que o hóspede veria no site.
      if (failure.status && failure.status < 500 && failure.status !== 403) setRefusal(failure.message);
      else toast.error("Não foi possível simular", { description: failure.message });
    } finally {
      setLoading(false);
    }
  };

  // "Simular estadia" na seleção do calendário: preenche, roda e traz o simulador para a vista.
  useEffect(() => {
    if (!request) return;
    const next = { ...form, inicio: request.inicio, fim: request.fim };
    setForm(next);
    void simulate(next);
    section.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Só reage a um novo pedido (nonce); form/simulate mudam a cada digitação.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce]);

  const nights: { date: string; amount: number }[] = quote?.nightlyBreakdown ?? [];
  const groups = groupNights(nights, tariffs);

  return (
    <section ref={section} className="scroll-mt-4 space-y-3">
      <h4 className="flex items-center gap-2 text-xs font-semibold text-foreground sm:text-sm">
        <Calculator className="h-4 w-4 text-primary" />
        Simular diárias
      </h4>
      <div className="space-y-4 rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Field label="Entrada">
            <DatePicker
              value={form.inicio}
              min={today}
              aria-label="Entrada"
              onChange={(value) =>
                value && change({ ...form, inicio: value, fim: form.fim <= value ? addDays(value, minNights) : form.fim })
              }
              className="h-10 rounded-xl"
            />
          </Field>
          <Field label="Saída">
            <DatePicker
              value={form.fim}
              min={addDays(form.inicio, 1)}
              aria-label="Saída"
              onChange={(value) => value && change({ ...form, fim: value })}
              className="h-10 rounded-xl"
            />
          </Field>
          <Field label="Hóspedes">
            <div className="flex h-10 items-center rounded-xl border border-input bg-background">
              <button
                type="button"
                aria-label="Menos um hóspede"
                disabled={form.hospedes <= 1}
                onClick={() => change({ ...form, hospedes: form.hospedes - 1 })}
                className="grid h-full w-9 place-items-center rounded-l-xl text-muted-foreground transition-colors hover:cursor-pointer hover:bg-muted disabled:cursor-default disabled:opacity-40"
              >
                −
              </button>
              <span className="w-8 text-center text-sm font-semibold tabular-nums">{form.hospedes}</span>
              <button
                type="button"
                aria-label="Mais um hóspede"
                disabled={form.hospedes >= capacity}
                onClick={() => change({ ...form, hospedes: form.hospedes + 1 })}
                className="grid h-full w-9 place-items-center rounded-r-xl text-muted-foreground transition-colors hover:cursor-pointer hover:bg-muted disabled:cursor-default disabled:opacity-40"
              >
                +
              </button>
            </div>
          </Field>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {nightsCount ? (
              <span className="mr-2 rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary">{plural(nightsCount, "noite", "noites")}</span>
            ) : null}
            Mínimo: {plural(minNights, "noite", "noites")} · até {plural(capacity, "hóspede", "hóspedes")}
          </p>
          <Button type="button" onClick={() => simulate()} disabled={loading || !nightsCount} className="h-10 gap-2 rounded-xl px-5 hover:cursor-pointer">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
            Simular
          </Button>
        </div>

        {refusal ? (
          <div className="flex items-start gap-2.5 rounded-xl bg-amber-500/10 px-3.5 py-3 text-sm text-amber-800 animate-in fade-in-0 duration-200 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Essas datas não podem ser reservadas</p>
              <p className="text-xs">{refusal}</p>
            </div>
          </div>
        ) : null}

        {quote ? (
          quote.available === false ? (
            <div className="flex items-start gap-2.5 rounded-xl bg-amber-500/10 px-3.5 py-3 text-sm text-amber-800 animate-in fade-in-0 duration-200 dark:text-amber-300">
              <CalendarX className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Período indisponível</p>
                <p className="text-xs">Já existe reserva ou bloqueio nessas datas. Veja no calendário acima.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3 animate-in fade-in-0 slide-in-from-top-1 duration-300">
              <div className="space-y-2">
                {groups.map((group) => (
                  <div key={`${group.key}-${group.from}`} className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-muted/20 px-3.5 py-2.5">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        <span className={cn("h-2 w-2 shrink-0 rounded-full", group.special ? "bg-[#c9a96a]" : "bg-muted-foreground/40")} />
                        <span className="truncate">{group.label}</span>
                        {group.exclusive ? <Lock className="h-3 w-3 shrink-0 text-violet-600 dark:text-violet-400" /> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {group.count === 1 ? `Noite de ${dateLabel(group.from)}` : `Noites de ${dateLabel(group.from)} a ${dateLabel(group.to)}`} ·{" "}
                        {plural(group.count, "noite", "noites")} × {money(group.amount)}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">{money(group.count * group.amount)}</span>
                  </div>
                ))}
              </div>

              {nights.length > 1 ? (
                <button type="button" onClick={() => setDetails((v) => !v)} className="text-xs font-medium text-primary hover:underline hover:cursor-pointer">
                  {details ? "Ocultar noite a noite" : "Ver noite a noite"}
                </button>
              ) : null}
              {details ? (
                <div className="max-h-56 space-y-1 overflow-auto rounded-xl border border-border/50 p-2.5 animate-in fade-in-0 duration-200">
                  {nights.map((night) => (
                    <div key={night.date} className="flex justify-between gap-3 text-xs">
                      <span className="capitalize text-muted-foreground">{shortDay(night.date)}</span>
                      <span className="tabular-nums">{money(night.amount)}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="space-y-1.5 rounded-xl bg-primary/[0.05] px-3.5 py-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Diárias ({plural(nights.length, "noite", "noites")})</span>
                  <span className="tabular-nums">{money(quote.subtotal)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Taxa de limpeza</span>
                  <span className="tabular-nums">{money(quote.fees)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-t border-border/50 pt-2">
                  <span className="font-semibold">Total da estadia</span>
                  <span className="text-lg font-bold tabular-nums text-primary">{money(quote.total)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Média de {money(nights.length ? quote.total / nights.length : 0)} por noite com a limpeza · simulação: nada é reservado.
                </p>
              </div>
            </div>
          )
        ) : null}
      </div>
    </section>
  );
}
