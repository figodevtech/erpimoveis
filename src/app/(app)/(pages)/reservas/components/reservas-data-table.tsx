"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Building2,
  Calendar,
  CalendarDays,
  ChevronsLeft,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsRight,
  List,
  Loader,
  Loader2,
  Plus,
  RotateCw,
  User,
  Users,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { AnimatePresence, motion } from "motion/react";
import { Pagination, Reserva, ReservasTab, RESERVAS_TABS } from "../types";
import { StatusBadge } from "@/components/imobiliario/shared";
import { clientName, dateLabel, money, propertyName } from "@/components/imobiliario/model";
import { ReservationsCalendar } from "@/components/imobiliario/reservations-calendar";
import { RowActions } from "@/components/imobiliario/row-actions";
import { cn } from "@/lib/utils";

interface ReservasDataTableProps {
  reservas: Reserva[];
  isLoading: boolean;
  pagination: Pagination;
  view: "list" | "calendar";
  onViewChange: (view: "list" | "calendar") => void;
  tab: ReservasTab;
  onTabChange: (tab: ReservasTab) => void;
  ativasCount?: number;
  finalizadasCount?: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onRefresh: () => void;
  onSelectReserva: (id: number) => void;
  onNewReserva?: (initial?: any) => void;
  canCreate: boolean;
  canEdit: boolean;
  propertyId: number | null;
  calendarVersion: number;
}

function getNights(inicio?: string | null, fim?: string | null): number | null {
  if (!inicio || !fim) return null;
  const d1 = new Date(`${String(inicio).slice(0, 10)}T12:00:00`);
  const d2 = new Date(`${String(fim).slice(0, 10)}T12:00:00`);
  const diffTime = d2.getTime() - d1.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  return isNaN(diffDays) || diffDays <= 0 ? null : diffDays;
}

export default function ReservasDataTable({
  reservas,
  isLoading,
  pagination,
  view,
  onViewChange,
  tab,
  onTabChange,
  ativasCount,
  finalizadasCount,
  onPageChange,
  onPageSizeChange,
  onRefresh,
  onSelectReserva,
  onNewReserva,
  canCreate,
  canEdit,
  propertyId,
  calendarVersion,
}: ReservasDataTableProps) {
  return (
    <Card className="shadow-xs border-border/80">
      <CardHeader className="border-b pb-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base sm:text-lg font-semibold">
                Reservas Cadastradas
              </CardTitle>
              <Badge variant="secondary" className="text-xs font-normal">
                {pagination.total} {pagination.total === 1 ? "registro" : "registros"}
              </Badge>
            </div>
            <CardDescription className="flex items-center gap-2 text-xs">
              <span>Gestão de hospedagens, calendário e ocupação.</span>
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:cursor-pointer transition-colors"
                title="Recarregar dados"
              >
                <span>Recarregar</span>
                <RotateCw className={cn("h-3 w-3", isLoading && "animate-spin text-primary")} />
              </button>
            </CardDescription>
          </div>

          {/* Tabs "Abertas" e "Finalizadas" (Apenas no modo lista) */}
          {view === "list" ? (
            <div className="flex min-w-0 items-center justify-start lg:justify-center">
              <div
                role="tablist"
                aria-label="Visualização de reservas"
                className="inline-flex h-auto max-w-full items-center gap-1.5 overflow-x-auto rounded-2xl border bg-muted/40 p-1 backdrop-blur-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {RESERVAS_TABS.map((t) => {
                  const ativo = tab === t.value;
                  const count = t.value === "ABERTAS" ? ativasCount : finalizadasCount;

                  return (
                    <button
                      key={t.value}
                      type="button"
                      role="tab"
                      aria-selected={ativo}
                      onClick={() => onTabChange(t.value)}
                      className={cn(
                        "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-transparent px-3.5 text-xs font-medium transition-all hover:cursor-pointer",
                        ativo
                          ? "bg-primary text-primary-foreground shadow-sm font-semibold"
                          : "text-muted-foreground hover:bg-background/50 hover:text-foreground"
                      )}
                    >
                      <span>{t.label}</span>
                      {count !== undefined ? (
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                            ativo
                              ? "bg-primary-foreground/20 text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          {count}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Alternador Lista / Calendário estilizado */}
            <div className="flex items-center rounded-lg border border-border/70 p-1 bg-muted/30">
              <Button
                size="sm"
                variant={view === "list" ? "secondary" : "ghost"}
                onClick={() => onViewChange("list")}
                className={cn(
                  "h-8 px-2.5 text-xs hover:cursor-pointer transition-all",
                  view === "list" && "bg-background shadow-2xs font-semibold text-foreground"
                )}
              >
                <List className="h-3.5 w-3.5 mr-1.5" />
                Lista
              </Button>
              <Button
                size="sm"
                variant={view === "calendar" ? "secondary" : "ghost"}
                onClick={() => onViewChange("calendar")}
                className={cn(
                  "h-8 px-2.5 text-xs hover:cursor-pointer transition-all",
                  view === "calendar" && "bg-background shadow-2xs font-semibold text-foreground"
                )}
              >
                <CalendarDays className="h-3.5 w-3.5 mr-1.5" />
                Calendário
              </Button>
            </div>

            {canCreate && onNewReserva ? (
              <Button
                size="sm"
                onClick={() => onNewReserva()}
                className="h-9 gap-1.5 text-xs font-semibold hover:cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Nova Reserva
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="min-h-[320px] px-4 pb-4 pt-0 relative">
        {/* Barra de Progresso Animada */}
        <div
          className={cn(
            "transition-opacity duration-200 h-0.5 bg-muted w-full overflow-hidden absolute left-0 right-0 top-0",
            isLoading ? "opacity-100" : "opacity-0"
          )}
        >
          <div
            className={cn(
              "w-1/2 bg-primary h-full absolute left-0 rounded-lg -translate-x-full",
              isLoading && "animate-slideIn"
            )}
          />
        </div>

        {/* Transição Suave entre Lista e Calendário */}
        <AnimatePresence mode="wait">
          {view === "calendar" ? (
            <motion.div
              key="calendar-view"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="mt-6 min-h-[660px] sm:min-h-[760px] flex flex-col"
            >
              <ReservationsCalendar
                key={calendarVersion}
                propertyId={propertyId ? String(propertyId) : undefined}
                onOpen={(id) => onSelectReserva(id)}
                onNew={canCreate && onNewReserva ? (seed) => onNewReserva(seed) : undefined}
              />
            </motion.div>
          ) : (
            <motion.div
              key="list-view"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              <div className="overflow-x-auto rounded-lg border border-border/60 mt-6 bg-card">
                <Table className="text-xs">
                  <TableHeader className="bg-muted/40">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[100px] font-semibold">Código</TableHead>
                      <TableHead className="font-semibold">Imóvel</TableHead>
                      <TableHead className="font-semibold">Hóspede & Período</TableHead>
                      <TableHead className="w-[100px] text-center font-semibold">Ocupação</TableHead>
                      <TableHead className="font-semibold">Situação</TableHead>
                      <TableHead className="text-right font-semibold">Valor Total</TableHead>
                      <TableHead className="w-[60px] text-center font-semibold">Ações</TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {reservas.length === 0 && !isLoading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="h-44 text-center">
                          <div className="flex flex-col items-center justify-center gap-2.5 text-muted-foreground">
                            <div className="rounded-full bg-muted p-3">
                              <CalendarDays className="h-6 w-6" />
                            </div>
                            <p className="font-medium text-foreground text-sm">
                              Nenhuma reserva encontrada
                            </p>
                            <p className="text-xs max-w-sm">
                              Tente modificar os filtros de busca por período, hóspede ou imóvel.
                            </p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      reservas.map((reserva, idx) => {
                        const nomeImovel = propertyName(reserva as any);
                        const nomeCliente = clientName(reserva as any);
                        const nights = getNights(reserva.inicio, reserva.fim);

                        return (
                          <TableRow
                            key={reserva.id}
                            className="hover:cursor-pointer hover:bg-muted/30 transition-colors group"
                            onDoubleClick={() => onSelectReserva(reserva.id)}
                            onClick={() => onSelectReserva(reserva.id)}
                          >
                            {/* Código */}
                            <TableCell className="font-mono">
                              <span className="inline-block rounded bg-muted/60 px-2 py-0.5 text-[11px] font-semibold text-foreground border border-border/50">
                                #{reserva.codigo ?? reserva.id}
                              </span>
                            </TableCell>

                            {/* Imóvel */}
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="flex h-7 w-7 items-center justify-center rounded bg-muted/60 text-muted-foreground shrink-0 border border-border/40 group-hover:border-primary/30 group-hover:text-primary transition-colors">
                                  <Building2 className="h-3.5 w-3.5" />
                                </div>
                                <div className="min-w-0">
                                  <p className="font-semibold text-foreground truncate max-w-[240px]">
                                    {nomeImovel}
                                  </p>
                                  <span className="text-[11px] text-muted-foreground">
                                    {reserva.imovel_id ? `Imóvel #${reserva.imovel_id}` : ""}
                                  </span>
                                </div>
                              </div>
                            </TableCell>

                            {/* Hóspede & Período */}
                            <TableCell>
                              <div className="flex items-center gap-2.5">
                                <Avatar className="h-7 w-7 shrink-0 border border-border/50">
                                  <AvatarFallback className="bg-primary/10 text-primary font-bold text-[10px]">
                                    {nomeCliente ? nomeCliente.slice(0, 2).toUpperCase() : <User className="h-3.5 w-3.5" />}
                                  </AvatarFallback>
                                </Avatar>

                                <div className="space-y-0.5 min-w-0">
                                  <p className="font-semibold text-foreground truncate max-w-[200px]">
                                    {nomeCliente}
                                  </p>
                                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                    <Calendar className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                                    <span>
                                      {dateLabel(reserva.inicio)} até {dateLabel(reserva.fim)}
                                    </span>
                                    {nights ? (
                                      <Badge
                                        variant="outline"
                                        className="h-4 px-1 text-[10px] bg-muted/50 font-normal border-border/60"
                                      >
                                        🌙 {nights} {nights === 1 ? "noite" : "noites"}
                                      </Badge>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            </TableCell>

                            {/* Hóspedes */}
                            <TableCell className="text-center">
                              <Badge
                                variant="outline"
                                className="inline-flex items-center gap-1 text-xs font-medium border-border/60 bg-muted/20"
                              >
                                <Users className="h-3 w-3 text-primary" />
                                {reserva.hospedes ?? 1} {Number(reserva.hospedes) === 1 ? "hóspede" : "hóspedes"}
                              </Badge>
                            </TableCell>

                            {/* Situação */}
                            <TableCell>
                              <div className="flex flex-col gap-1 items-start">
                                <StatusBadge status={reserva.status} />
                                {reserva.financeiro_status ? (
                                  <StatusBadge status={reserva.financeiro_status} />
                                ) : null}
                              </div>
                            </TableCell>

                            {/* Valor Total */}
                            <TableCell className="text-right font-semibold text-foreground tabular-nums whitespace-nowrap text-sm">
                              {money(reserva.valor_total ?? reserva.diaria)}
                            </TableCell>

                            {/* Ações */}
                            <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                              <RowActions canEdit={canEdit} onOpen={() => onSelectReserva(reserva.id)} />
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Paginação */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-5 pt-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Total de {pagination.total} registros cadastrados</span>
                  <Loader
                    className={cn(
                      "w-3.5 h-3.5 animate-spin transition-opacity",
                      isLoading ? "opacity-100" : "opacity-0"
                    )}
                  />
                </div>

                <div className="flex items-center justify-center space-x-1 sm:space-x-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0 hover:cursor-pointer"
                    onClick={() => onPageChange(1)}
                    disabled={pagination.page <= 1 || isLoading}
                    title="Primeira página"
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0 hover:cursor-pointer"
                    onClick={() => onPageChange(pagination.page - 1)}
                    disabled={pagination.page <= 1 || isLoading}
                    title="Página anterior"
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </Button>

                  <span className="text-[11px] sm:text-xs font-medium px-2.5">
                    Pg. {pagination.page} de {pagination.totalPages || 1}
                  </span>

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0 hover:cursor-pointer"
                    onClick={() => onPageChange(pagination.page + 1)}
                    disabled={
                      pagination.page >= pagination.totalPages ||
                      pagination.totalPages === 0 ||
                      isLoading
                    }
                    title="Próxima página"
                  >
                    <ChevronRightIcon className="h-4 w-4" />
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0 hover:cursor-pointer"
                    onClick={() => onPageChange(pagination.totalPages)}
                    disabled={
                      pagination.page >= pagination.totalPages ||
                      pagination.totalPages === 0 ||
                      isLoading
                    }
                    title="Última página"
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Linhas por página:</span>
                  <Select
                    value={String(pagination.limit)}
                    onValueChange={(val) => onPageSizeChange(Number(val))}
                  >
                    <SelectTrigger size="sm" className="w-[72px] h-8 text-xs hover:cursor-pointer">
                      <SelectValue placeholder={pagination.limit} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem className="hover:cursor-pointer text-xs" value="10">
                        10
                      </SelectItem>
                      <SelectItem className="hover:cursor-pointer text-xs" value="20">
                        20
                      </SelectItem>
                      <SelectItem className="hover:cursor-pointer text-xs" value="50">
                        50
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
