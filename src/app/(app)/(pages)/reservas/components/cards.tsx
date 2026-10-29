import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarCheck, CalendarDays, CalendarX } from "lucide-react";
import { ReservasCardsProps } from "../types";

export default function Cards({
  loadingStatusCounter,
  totalReservas,
  ativas,
  finalizadas,
}: ReservasCardsProps) {
  return (
    <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 mb-6">
      <Card className="gap-0 py-4">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total de Reservas</CardTitle>
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {loadingStatusCounter ? (
            <Skeleton className="h-8 w-8" />
          ) : (
            <div className="text-2xl font-bold">{totalReservas || 0}</div>
          )}
          <p className="text-xs text-muted-foreground">Reservas registradas</p>
        </CardContent>
      </Card>

      <Card className="gap-0 py-4">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Confirmadas / Em Andamento</CardTitle>
          <CalendarCheck className="h-4 w-4 text-chart-4" />
        </CardHeader>
        <CardContent>
          {loadingStatusCounter ? (
            <Skeleton className="h-8 w-8" />
          ) : (
            <div className="text-2xl font-bold text-chart-4">{ativas || 0}</div>
          )}
          <p className="text-xs text-muted-foreground">Hospedagens ativas</p>
        </CardContent>
      </Card>

      <Card className="gap-2 py-4 col-span-2 sm:col-span-1">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Concluídas / Canceladas</CardTitle>
          <CalendarX className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {loadingStatusCounter ? (
            <Skeleton className="h-8 w-8" />
          ) : (
            <div className="text-2xl font-bold text-muted-foreground">{finalizadas || 0}</div>
          )}
          <p className="text-xs text-muted-foreground">Histórico encerrado</p>
        </CardContent>
      </Card>
    </div>
  );
}

