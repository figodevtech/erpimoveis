"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  User,
  Users,
  Building2,
  Clock,
  Sparkles,
  Bed,
} from "lucide-react";
import { StatusBadge, requestJson } from "./shared";
import {
  type Entity,
  clientName,
  dateLabel,
  listFrom,
  money,
  propertyName,
  titleCase,
} from "./model";
import { cn } from "@/lib/utils";

const civil = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;

function formatFullDate(dateStr: string) {
  try {
    const [year, month, day] = dateStr.split("-").map(Number);
    const d = new Date(year, month - 1, day, 12, 0, 0);
    return new Intl.DateTimeFormat("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d);
  } catch {
    return dateLabel(dateStr);
  }
}

function shiftDay(dateStr: string, deltaDays: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day + deltaDays, 12, 0, 0);
  return civil(d);
}

function getNights(inicio?: string | null, fim?: string | null): number | null {
  if (!inicio || !fim) return null;
  const d1 = new Date(`${String(inicio).slice(0, 10)}T12:00:00`);
  const d2 = new Date(`${String(fim).slice(0, 10)}T12:00:00`);
  const diffTime = d2.getTime() - d1.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  return isNaN(diffDays) || diffDays <= 0 ? null : diffDays;
}

const monthVariants: Variants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 30 : -30,
    opacity: 0,
    filter: "blur(2px)",
  }),
  center: {
    x: 0,
    opacity: 1,
    filter: "blur(0px)",
    transition: {
      x: { type: "spring" as const, stiffness: 380, damping: 34 },
      opacity: { duration: 0.2 },
      filter: { duration: 0.2 },
    },
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -30 : 30,
    opacity: 0,
    filter: "blur(2px)",
    transition: {
      x: { type: "spring" as const, stiffness: 380, damping: 34 },
      opacity: { duration: 0.15 },
      filter: { duration: 0.15 },
    },
  }),
};

export function ReservationsCalendar({
  propertyId,
  ownerId,
  onOpen,
  onNew,
}: {
  propertyId?: string;
  ownerId?: string;
  onOpen: (id: number) => void;
  onNew?: (initial: Entity) => void;
}) {
  const todayCivil = civil(new Date());
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );
  const [direction, setDirection] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"month" | "day">("month");

  // Cache em memória para transições instantâneas entre meses
  const cacheRef = useRef<Map<string, Entity[]>>(new Map());
  const [monthReservas, setMonthReservas] = useState<Entity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  const cacheKey = `${monthKey}-${propertyId || ""}-${ownerId || ""}`;

  // Função para buscar as reservas do mês sem destruir o layout
  const fetchMonthData = useCallback(
    async (targetMonth: Date, force = false) => {
      const key = `${targetMonth.getFullYear()}-${String(targetMonth.getMonth() + 1).padStart(2, "0")}`;
      const cKey = `${key}-${propertyId || ""}-${ownerId || ""}`;

      if (!force && cacheRef.current.has(cKey)) {
        setMonthReservas(cacheRef.current.get(cKey)!);
        setIsLoading(false);
        setError(null);
        return;
      }

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      setError(null);

      try {
        const first = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);
        const nextMonthFirst = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 1);
        const start = civil(first);
        const end = civil(nextMonthFirst);

        const params = new URLSearchParams({
          inicio: start,
          fim: end,
          pageSize: "100",
          page: "1",
        });
        if (propertyId) params.set("imovel_id", propertyId);
        if (ownerId) params.set("proprietario_id", ownerId);

        const res = await requestJson(`/api/reservas?${params.toString()}`, {
          signal: controller.signal,
        });
        const firstPage = listFrom(res);
        const allItems = [...firstPage.items];
        const size = firstPage.pageSize || 100;

        for (let page = 2; (page - 1) * size < firstPage.total; page += 1) {
          if (controller.signal.aborted) return;
          params.set("page", String(page));
          const nextRes = await requestJson(`/api/reservas?${params.toString()}`, {
            signal: controller.signal,
          });
          const nextPage = listFrom(nextRes);
          if (!nextPage.items.length) break;
          allItems.push(...nextPage.items);
        }

        const validItems = [...new Map(allItems.map((r) => [r.id, r])).values()].filter(
          (r) => r.status !== "CANCELADA"
        );

        if (!controller.signal.aborted) {
          cacheRef.current.set(cKey, validItems);
          setMonthReservas(validItems);
          setIsLoading(false);
        }
      } catch (err: any) {
        if (!controller.signal.aborted) {
          console.error("Erro ao carregar reservas do mês:", err);
          setError(err?.message || "Não foi possível carregar as reservas.");
          setIsLoading(false);
        }
      }
    },
    [propertyId, ownerId]
  );

  useEffect(() => {
    void fetchMonthData(month);
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [month, fetchMonthData]);

  // Tecla Escape para retornar à visão de mês
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && viewMode === "day") {
        setViewMode("month");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewMode]);

  // Montagem da grade do mês
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const firstDayOfWeek = first.getDay(); // 0 = Domingo
  const daysInMonth = last.getDate();

  const calendarDays = useMemo(() => {
    const items: (Date | null)[] = [];
    for (let i = 0; i < firstDayOfWeek; i++) {
      items.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      items.push(new Date(month.getFullYear(), month.getMonth(), i));
    }
    return items;
  }, [firstDayOfWeek, daysInMonth, month]);

  // Reservas ativas no dia key (para as células do calendário)
  const getReservasForCell = useCallback(
    (key: string) => {
      return monthReservas.filter((row) => {
        const start = String(row.inicio).slice(0, 10);
        const end = String(row.fim).slice(0, 10);
        return start <= key && end > key;
      });
    },
    [monthReservas]
  );

  // Reservas com movimentação ou hospedagem no dia selecionado (para a visão do dia expandido)
  const getReservasForDay = useCallback(
    (dayKey: string) => {
      return monthReservas.filter((row) => {
        const start = String(row.inicio).slice(0, 10);
        const end = String(row.fim).slice(0, 10);
        return (start <= dayKey && end > dayKey) || start === dayKey || end === dayKey;
      });
    },
    [monthReservas]
  );

  const handleSelectDay = (dayKey: string) => {
    setSelectedDay(dayKey);
    setViewMode("day");
  };

  const handlePrevMonth = () => {
    setDirection(-1);
    setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1));
    setSelectedDay(null);
    setViewMode("month");
  };

  const handleNextMonth = () => {
    setDirection(1);
    setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1));
    setSelectedDay(null);
    setViewMode("month");
  };

  const handleToday = () => {
    const now = new Date();
    const targetMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const dir = targetMonth.getTime() >= month.getTime() ? 1 : -1;
    setDirection(dir);
    setMonth(targetMonth);
    setSelectedDay(civil(now));
  };

  return (
    <div className="space-y-4 min-h-[660px] sm:min-h-[760px] flex flex-col">
      <AnimatePresence mode="wait">
        {viewMode === "day" && selectedDay ? (
          /* ========================================================================= */
          /* VISÃO EXPANDIDA DO DIA (DAY DETAIL VIEW)                                 */
          /* ========================================================================= */
          <motion.div
            key="day-view"
            initial={{ opacity: 0, scale: 0.98, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -12 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="space-y-4 min-h-[660px] sm:min-h-[760px] flex flex-col flex-1"
          >
            {/* Barra de Retorno e Navegação do Dia */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border/70 bg-card p-4 shadow-2xs">
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setViewMode("month")}
                  className="h-8 gap-1.5 text-xs font-medium hover:cursor-pointer hover:bg-muted"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Voltar para o Mês
                </Button>

                <div className="flex items-center gap-1 border-l border-border/60 pl-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:cursor-pointer"
                    onClick={() => setSelectedDay(shiftDay(selectedDay, -1))}
                    title="Dia anterior"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:cursor-pointer"
                    onClick={() => setSelectedDay(shiftDay(selectedDay, 1))}
                    title="Próximo dia"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Informações da Data */}
              <div className="space-y-0.5 text-left sm:text-right">
                <div className="flex items-center gap-2 sm:justify-end">
                  <h3 className="text-base font-semibold capitalize text-foreground">
                    {formatFullDate(selectedDay)}
                  </h3>
                  {selectedDay === todayCivil ? (
                    <Badge variant="secondary" className="text-[10px] font-semibold">
                      Hoje
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {getReservasForDay(selectedDay).length}{" "}
                  {getReservasForDay(selectedDay).length === 1
                    ? "reserva ativa ou com movimentação"
                    : "reservas ativas ou com movimentação"}
                </p>
              </div>

              {/* Ação de Nova Reserva nesta data */}
              {onNew ? (
                <Button
                  size="sm"
                  onClick={() => {
                    const nextDay = shiftDay(selectedDay, 1);
                    onNew({
                      inicio: selectedDay,
                      fim: nextDay,
                      ...(propertyId ? { imovel_id: Number(propertyId) } : {}),
                    });
                  }}
                  className="h-8 text-xs gap-1.5 hover:cursor-pointer ml-auto sm:ml-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Nova reserva nesta data
                </Button>
              ) : null}
            </div>

            {/* Lista de Reservas do Dia */}
            <div className="space-y-3 flex-1 flex flex-col">
              {getReservasForDay(selectedDay).map((row, index) => {
                const isCheckIn = String(row.inicio).slice(0, 10) === selectedDay;
                const isCheckOut = String(row.fim).slice(0, 10) === selectedDay;
                const nights = getNights(row.inicio, row.fim);
                const imovelTitulo = propertyName(row);
                const clienteNome = clientName(row);

                return (
                  <motion.div
                    key={row.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05, duration: 0.2 }}
                    className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 rounded-xl border border-border/70 bg-card p-4 transition-all duration-200 hover:border-primary/40 hover:bg-muted/20 hover:shadow-2xs"
                  >
                    <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/50 text-foreground">
                        <Building2 className="h-5 w-5" />
                      </div>

                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-semibold text-sm sm:text-base text-foreground truncate">
                            {imovelTitulo}
                          </h4>
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground border border-border/40">
                            #{row.codigo || row.id}
                          </span>

                          {/* Tag de Movimentação */}
                          {isCheckIn ? (
                            <Badge
                              variant="outline"
                              className="border-emerald-500/30 text-emerald-700 bg-emerald-500/10 dark:text-emerald-400 text-[10px] font-semibold"
                            >
                              📥 Check-in hoje
                            </Badge>
                          ) : isCheckOut ? (
                            <Badge
                              variant="outline"
                              className="border-amber-500/30 text-amber-700 bg-amber-500/10 dark:text-amber-400 text-[10px] font-semibold"
                            >
                              📤 Check-out hoje
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-sky-500/30 text-sky-700 bg-sky-500/10 dark:text-sky-400 text-[10px] font-semibold"
                            >
                              🛏️ Hospedado
                            </Badge>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1 font-medium text-foreground/90">
                            <User className="h-3.5 w-3.5 text-muted-foreground/80" />
                            {clienteNome}
                          </span>
                          <span>•</span>
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5 text-muted-foreground/80" />
                            {dateLabel(row.inicio)} a {dateLabel(row.fim)}
                            {nights ? ` (${nights} ${nights === 1 ? "noite" : "noites"})` : ""}
                          </span>
                          <span>•</span>
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-3.5 w-3.5 text-muted-foreground/80" />
                            {row.hospedes ?? 1} {Number(row.hospedes) === 1 ? "hóspede" : "hóspedes"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-border/40">
                      <div className="space-y-1 text-left sm:text-right">
                        <div className="flex items-center gap-1.5 sm:justify-end">
                          <StatusBadge status={row.status} />
                          {row.financeiro_status ? (
                            <StatusBadge status={row.financeiro_status} />
                          ) : null}
                        </div>
                        <p className="text-sm font-bold text-foreground">
                          {money(row.valor_total ?? row.diaria)}
                        </p>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onOpen(Number(row.id))}
                        className="h-8 text-xs gap-1.5 hover:cursor-pointer"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Ver Cadastro
                      </Button>
                    </div>
                  </motion.div>
                );
              })}

              {!getReservasForDay(selectedDay).length ? (
                <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/80 bg-muted/10 p-8 text-center flex-1 min-h-[380px] sm:min-h-[460px]">
                  <div className="rounded-full bg-muted p-3 text-muted-foreground">
                    <CalendarDays className="h-6 w-6" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">
                      Nenhuma reserva para este dia
                    </p>
                    <p className="text-xs text-muted-foreground max-w-sm">
                      Não há check-ins, check-outs ou hóspedes acomodados nesta data.
                    </p>
                  </div>
                  {onNew ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        const nextDay = shiftDay(selectedDay, 1);
                        onNew({
                          inicio: selectedDay,
                          fim: nextDay,
                          ...(propertyId ? { imovel_id: Number(propertyId) } : {}),
                        });
                      }}
                      className="h-8 text-xs gap-1.5 hover:cursor-pointer mt-1"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Criar reserva para esta data
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </motion.div>
        ) : (
          /* ========================================================================= */
          /* VISÃO COMPLETA DO MÊS (MONTH GRID VIEW) COM TRANSIÇÃO SUAVE              */
          /* ========================================================================= */
          <div className="space-y-4">
            {/* Header do Navegador de Meses */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border/70 bg-card p-3.5 sm:p-4 shadow-2xs">
              <div className="flex items-center gap-2">
                <Button
                  aria-label="Mês anterior"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 hover:cursor-pointer"
                  onClick={handlePrevMonth}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  aria-label="Próximo mês"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 hover:cursor-pointer"
                  onClick={handleNextMonth}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleToday}
                  className="h-8 text-xs hover:cursor-pointer font-medium"
                >
                  Hoje
                </Button>
              </div>

              <div className="flex items-center gap-2.5">
                <h2 className="text-base sm:text-lg font-semibold capitalize text-foreground">
                  {month.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
                </h2>
                {isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                ) : (
                  <Badge variant="secondary" className="text-xs font-normal">
                    {monthReservas.length}{" "}
                    {monthReservas.length === 1 ? "reserva no mês" : "reservas no mês"}
                  </Badge>
                )}
              </div>

              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-primary" />
                Clique em qualquer dia para expandir os detalhes
              </div>
            </div>

            {error ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs hover:cursor-pointer"
                  onClick={() => fetchMonthData(month, true)}
                >
                  Tentar novamente
                </Button>
              </div>
            ) : null}

            {/* Container da Grade com Linha Discreta de Loading e Transição Framer Motion */}
            <div className="relative overflow-hidden rounded-xl border border-border/80 shadow-2xs bg-card">
              {/* Barra de Progresso Discreta durante o carregamento de dados */}
              <div
                className={cn(
                  "absolute top-0 left-0 right-0 h-0.5 z-20 overflow-hidden bg-muted transition-opacity duration-300",
                  isLoading ? "opacity-100" : "opacity-0 pointer-events-none"
                )}
              >
                <div className="h-full w-1/2 bg-primary rounded-full animate-slideIn" />
              </div>

              {/* Animação de Deslize entre Meses */}
              <AnimatePresence mode="wait" custom={direction} initial={false}>
                <motion.div
                  key={monthKey}
                  custom={direction}
                  variants={monthVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="w-full"
                >
                  <div className="overflow-x-auto">
                    <div className="grid min-w-[720px] grid-cols-7">
                      {/* Cabeçalho dos Dias da Semana */}
                      {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((label) => (
                        <div
                          key={label}
                          className="border-b border-r last:border-r-0 bg-muted/40 p-2.5 text-center text-xs font-semibold text-muted-foreground"
                        >
                          {label}
                        </div>
                      ))}

                      {/* Células dos Dias */}
                      {calendarDays.map((date, index) => {
                        if (!date) {
                          return (
                            <div
                              key={`blank-${index}`}
                              className="min-h-28 sm:min-h-32 border-b border-r last:border-r-0 bg-muted/15"
                            />
                          );
                        }

                        const key = civil(date);
                        const entries = getReservasForCell(key);
                        const isToday = key === todayCivil;

                        return (
                          <motion.div
                            key={key}
                            whileHover={{ y: -2 }}
                            transition={{ type: "spring", stiffness: 450, damping: 28 }}
                            onClick={() => handleSelectDay(key)}
                            className={cn(
                              "group relative min-h-28 sm:min-h-32 border-b border-r last:border-r-0 p-2 flex flex-col justify-between transition-all duration-200 cursor-pointer select-none",
                              "hover:bg-muted/30 hover:border-primary/40 hover:shadow-2xs",
                              isToday ? "bg-primary/5 border-primary/30" : "bg-card"
                            )}
                            title={`Clique para expandir o dia ${dateLabel(key)}`}
                          >
                            {/* Topo da Célula: Dia e Indicador */}
                            <div className="flex items-center justify-between w-full">
                              <span
                                className={cn(
                                  "flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                                  isToday
                                    ? "bg-primary text-primary-foreground font-bold shadow-xs"
                                    : "text-foreground/80 group-hover:bg-primary/10 group-hover:text-primary"
                                )}
                              >
                                {date.getDate()}
                              </span>

                              <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-medium text-primary flex items-center gap-0.5">
                                Ver dia →
                              </span>
                            </div>

                            {/* Itens de Reserva na Célula */}
                            <div className="space-y-1 w-full my-auto py-1">
                              {entries.slice(0, 2).map((row) => (
                                <div
                                  key={row.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpen(Number(row.id));
                                  }}
                                  className={cn(
                                    "w-full truncate rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors text-left",
                                    row.status === "EM_ANDAMENTO"
                                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                                      : "border-primary/20 bg-primary/10 text-primary hover:bg-primary/20"
                                  )}
                                  title={`${propertyName(row)} · ${clientName(row)}`}
                                >
                                  <div className="flex items-center gap-1 truncate">
                                    <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-current" />
                                    <span className="truncate">{propertyName(row)}</span>
                                  </div>
                                </div>
                              ))}

                              {entries.length > 2 ? (
                                <div className="text-[10px] font-semibold text-muted-foreground group-hover:text-primary transition-colors pl-1">
                                  +{entries.length - 2} reservas
                                </div>
                              ) : null}
                            </div>

                            {/* Rodapé sutil da célula se houver reservas */}
                            <div className="h-1">
                              {entries.length > 0 ? (
                                <div className="h-1 w-6 rounded-full bg-primary/40 group-hover:bg-primary transition-colors" />
                              ) : null}
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
