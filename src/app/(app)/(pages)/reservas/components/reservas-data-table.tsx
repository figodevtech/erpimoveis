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
  CalendarDays,
  ChevronsLeft,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsRight,
  List,
  Loader,
  Loader2,
  Plus,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pagination, Reserva } from "../types";
import { StatusBadge } from "@/components/imobiliario/shared";
import { clientName, dateLabel, money, propertyName } from "@/components/imobiliario/model";
import { ReservationsCalendar } from "@/components/imobiliario/reservations-calendar";
import { RowActions } from "@/components/imobiliario/row-actions";

interface ReservasDataTableProps {
  reservas: Reserva[];
  isLoading: boolean;
  pagination: Pagination;
  view: "list" | "calendar";
  onViewChange: (view: "list" | "calendar") => void;
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

export default function ReservasDataTable({
  reservas,
  isLoading,
  pagination,
  view,
  onViewChange,
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
    <Card>
      <CardHeader className="border-b-2 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle>Lista de Reservas</CardTitle>
            <CardDescription className="flex flex-col">
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70 hover:cursor-pointer"
              >
                <span>Recarregar</span>
                <Loader2 width={12} className={isLoading ? "animate-spin" : ""} />
              </button>
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            {/* Alternador Lista / Calendário */}
            <div className="flex gap-1 rounded-lg border p-1 bg-muted/20">
              <Button
                size="sm"
                variant={view === "list" ? "secondary" : "ghost"}
                onClick={() => onViewChange("list")}
                className="h-8 px-2 text-xs hover:cursor-pointer"
              >
                <List className="h-3.5 w-3.5 mr-1" />
                Lista
              </Button>
              <Button
                size="sm"
                variant={view === "calendar" ? "secondary" : "ghost"}
                onClick={() => onViewChange("calendar")}
                className="h-8 px-2 text-xs hover:cursor-pointer"
              >
                <CalendarDays className="h-3.5 w-3.5 mr-1" />
                Calendário
              </Button>
            </div>

            {canCreate && onNewReserva ? (
              <Button onClick={() => onNewReserva()} className="hover:cursor-pointer">
                <Plus className="h-4 w-4" /> Reserva
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="min-h-[300px] -mt-[24px] px-4 pb-4 pt-0 relative">
        <div
          className={`${
            isLoading ? "opacity-100" : "opacity-0"
          } transition-all h-0.5 bg-slate-400 w-full overflow-hidden absolute left-0 right-0 top-0`}
        >
          <div
            className={`w-1/2 bg-primary h-full absolute left-0 rounded-lg -translate-x-[100%] ${
              isLoading ? "animate-slideIn" : ""
            }`}
          />
        </div>

        {view === "calendar" ? (
          <div className="mt-8">
            <ReservationsCalendar
              key={calendarVersion}
              propertyId={propertyId ? String(propertyId) : undefined}
              onOpen={(id) => onSelectReserva(id)}
              onNew={canCreate && onNewReserva ? (seed) => onNewReserva(seed) : undefined}
            />
          </div>
        ) : (
          <>
            <Table className="mt-6 text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">Código</TableHead>
                  <TableHead>Imóvel</TableHead>
                  <TableHead>Cliente / Período</TableHead>
                  <TableHead className="w-[90px] text-center">Hóspedes</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Valor Total</TableHead>
                  <TableHead className="w-[50px]">Ações</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {reservas.length === 0 && !isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                      Nenhuma reserva encontrada.
                    </TableCell>
                  </TableRow>
                ) : (
                  reservas.map((reserva) => {
                    const nomeImovel = propertyName(reserva as any);
                    const nomeCliente = clientName(reserva as any);

                    return (
                      <TableRow
                        key={reserva.id}
                        className="hover:cursor-pointer"
                        onDoubleClick={() => onSelectReserva(reserva.id)}
                      >
                        <TableCell className="font-mono text-muted-foreground">
                          {reserva.codigo ?? `#${reserva.id}`}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-foreground">{nomeImovel}</div>
                          <span className="text-[11px] text-muted-foreground">
                            {reserva.imovel_id ? `ID #${reserva.imovel_id}` : ""}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{nomeCliente}</div>
                          <span className="text-[11px] text-muted-foreground">
                            {dateLabel(reserva.inicio)} até {dateLabel(reserva.fim)}
                          </span>
                        </TableCell>
                        <TableCell className="text-center font-medium">
                          {reserva.hospedes ?? 1}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <StatusBadge status={reserva.status} />
                            {reserva.financeiro_status ? (
                              <div>
                                <StatusBadge status={reserva.financeiro_status} />
                              </div>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap">
                          {money(reserva.valor_total ?? reserva.diaria)}
                        </TableCell>
                        <TableCell>
                          {/* Reserva não se exclui: cancela pela ação própria dentro do cadastro. */}
                          <RowActions canEdit={canEdit} onOpen={() => onSelectReserva(reserva.id)} />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>

            {/* Paginação */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Total de {pagination.total} registros</span>
                <Loader
                  className={`w-3.5 h-3.5 animate-spin transition-all opacity-0 ${
                    isLoading ? "opacity-100" : ""
                  }`}
                />
              </div>

              <div className="flex items-center justify-center space-x-1 sm:space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="hover:cursor-pointer"
                  onClick={() => onPageChange(1)}
                  disabled={pagination.page <= 1 || isLoading}
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="hover:cursor-pointer"
                  onClick={() => onPageChange(pagination.page - 1)}
                  disabled={pagination.page <= 1 || isLoading}
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </Button>

                <span className="text-[10px] sm:text-xs font-medium px-2">
                  Pg. {pagination.page} de {pagination.totalPages || 1}
                </span>

                <Button
                  variant="outline"
                  size="sm"
                  className="hover:cursor-pointer"
                  onClick={() => onPageChange(pagination.page + 1)}
                  disabled={pagination.page >= pagination.totalPages || pagination.totalPages === 0 || isLoading}
                >
                  <ChevronRightIcon className="h-4 w-4" />
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="hover:cursor-pointer"
                  onClick={() => onPageChange(pagination.totalPages)}
                  disabled={pagination.page >= pagination.totalPages || pagination.totalPages === 0 || isLoading}
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Por página:</span>
                <Select
                  value={String(pagination.limit)}
                  onValueChange={(val) => onPageSizeChange(Number(val))}
                >
                  <SelectTrigger size="sm" className="w-[70px] hover:cursor-pointer">
                    <SelectValue placeholder={pagination.limit} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem className="hover:cursor-pointer" value="10">10</SelectItem>
                    <SelectItem className="hover:cursor-pointer" value="20">20</SelectItem>
                    <SelectItem className="hover:cursor-pointer" value="50">50</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

