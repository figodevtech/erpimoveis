"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { AlertTriangle, TrendingDown, TrendingUp, CircleOff, Box } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";

interface CardsPropos {
  totalProducts: number;
  loadingStatusCounter: boolean;
  statusCounts: Record<string, number>;
}

export default function Cards({ loadingStatusCounter, totalProducts, statusCounts }: CardsPropos) {
  return (
    <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
      <Card className="gap-0 py-4">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total de Items</CardTitle>
          <Box className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {loadingStatusCounter ? (
            <Skeleton className="h-8 w-8"></Skeleton>
          ) : (
            <div className="text-2xl font-bold">{totalProducts}</div>
          )}
          <p className="text-xs text-muted-foreground">Produtos cadastrados</p>
        </CardContent>
      </Card>
      <Card className="gap-0 py-4">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Sem estoque</CardTitle>
          <CircleOff className="h-4 w-4 text-purple-600" />
        </CardHeader>
        <CardContent>
          {loadingStatusCounter ? (
            <Skeleton className="h-8 w-8"></Skeleton>
          ) : (
            <div className="text-2xl font-bold text-purple-600">{statusCounts.SEM_ESTOQUE}</div>
          )}
          <p className="text-xs text-muted-foreground">Estoque zerado</p>
        </CardContent>
      </Card>

      <Card className="gap-0 py-4">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Itens Críticos</CardTitle>
          <AlertTriangle className="h-4 w-4 text-destructive" />
        </CardHeader>
        <CardContent>
          {loadingStatusCounter ? (
            <Skeleton className="w-8 h-8"></Skeleton>
          ) : (
            <div className="text-2xl font-bold text-destructive">{statusCounts.CRITICO}</div>
          )}
          <p className="text-xs text-muted-foreground">Reposição urgente</p>
        </CardContent>
      </Card>

      <Card className="gap-0 py-4">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Estoque Baixo</CardTitle>
          <TrendingDown className="h-4 w-4 text-orange-500" />
        </CardHeader>
        <CardContent>
          {loadingStatusCounter ? (
            <Skeleton className="w-8 h-8"></Skeleton>
          ) : (
            <div className="text-2xl font-bold text-orange-500">{statusCounts.BAIXO}</div>
          )}
          <p className="text-xs text-muted-foreground">Atenção necessária</p>
        </CardContent>
      </Card>

      <Card className="gap-0 py-4 col-span-2 md:col-span-1">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Estoque Bom</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {loadingStatusCounter ? (
            <Skeleton className="w-8 h-8"></Skeleton>
          ) : (
            <div className="text-2xl font-bold">{statusCounts.OK}</div>
          )}
          <p className="text-xs text-muted-foreground">Valor do inventário</p>
        </CardContent>
      </Card>
    </div>
  );
}
