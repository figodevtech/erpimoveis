import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, CheckCircle2, Key } from "lucide-react";
import { ImoveisCardsProps } from "../types";

export default function Cards({
  loadingStatusCounter,
  totalImoveis,
  disponiveis,
  ocupados,
}: ImoveisCardsProps) {
  return (
    <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 mb-6">
      <Card className="gap-0 py-4">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total de Imóveis</CardTitle>
          <Building2 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {loadingStatusCounter ? (
            <Skeleton className="h-8 w-8" />
          ) : (
            <div className="text-2xl font-bold">{totalImoveis || 0}</div>
          )}
          <p className="text-xs text-muted-foreground">Imóveis cadastrados</p>
        </CardContent>
      </Card>

      <Card className="gap-0 py-4">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Imóveis Disponíveis</CardTitle>
          <CheckCircle2 className="h-4 w-4 text-chart-4" />
        </CardHeader>
        <CardContent>
          {loadingStatusCounter ? (
            <Skeleton className="h-8 w-8" />
          ) : (
            <div className="text-2xl font-bold text-chart-4">{disponiveis || 0}</div>
          )}
          <p className="text-xs text-muted-foreground">Prontos para locação / venda</p>
        </CardContent>
      </Card>

      <Card className="gap-2 py-4 col-span-2 sm:col-span-1">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Ocupados / Outros</CardTitle>
          <Key className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {loadingStatusCounter ? (
            <Skeleton className="h-8 w-8" />
          ) : (
            <div className="text-2xl font-bold text-muted-foreground">{ocupados || 0}</div>
          )}
          <p className="text-xs text-muted-foreground">Alugados, reservados ou em manutenção</p>
        </CardContent>
      </Card>
    </div>
  );
}

