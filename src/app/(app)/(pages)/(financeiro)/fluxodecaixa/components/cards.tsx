"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import {
  Package,
  TrendingDown,
  TrendingUp,
  BanknoteArrowUp,
  BanknoteArrowDown,
  Coins,
} from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import formatarEmReal from "@/utils/formatarEmReal";
import { StatusInfo } from "../types";

interface CardsProps {
  statusInfo: StatusInfo | undefined;
  isLoadingStatus: boolean;
}

export default function Cards({ statusInfo, isLoadingStatus }: CardsProps) {
  const handleFormatPercent = (v: number, v2: number) => {
    if (!v || !v2) {
      return 0;
    }
    if (v === 0 || v2 === 0) {
      return 0;
    }
    return Intl.NumberFormat("pt-BR", {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(Math.abs(v) / Math.abs(v2));
  };
  function calcularVariacaoPercentual(
    valorAtual: number,
    valorAnterior: number
  ) {
    const diferenca = valorAtual - valorAnterior;

    // Evita divisão por zero
    if (valorAnterior === 0) {
      return Infinity;
    }

    // Calcula a variação percentual com base no valor absoluto do anterior
    const variacaoPercentual = diferenca / Math.abs(valorAnterior);

    return Intl.NumberFormat("pt-BR", {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(variacaoPercentual);
  }

  return (
    <div className="text-nowrap grid gap-4 grid-cols-1 lg:grid-cols-3 items-stretch">
      <Card className="gap-1 py-4 h-full">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs lg:text-sm font-medium">
            Receita total{" "}
            <span className="text-muted-foreground">(Este mês)</span>
          </CardTitle>
          <Package className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="flex flex-row justify-between">
          <div className="flex flex-col justify-between">
            <BanknoteArrowUp className="text-green-800 dark:text-green-200" />

            {isLoadingStatus ? (
              <div className="h-7 flex items-center">
                <Skeleton className="h-4 w-30"></Skeleton>
              </div>
            ) : (
              <span className="text-base lg:text-xl">
                {statusInfo &&
                  formatarEmReal(statusInfo?.mesAtual.somaReceitas)}
              </span>
            )}

            <p className="text-xs text-muted-foreground">Mensal</p>
          </div>
          <div className="flex flex-col items-end text-xs">
            <Badge
              className={`
              ${
                statusInfo &&
                statusInfo.mesAtual.somaReceitas <
                  statusInfo?.mesAnterior.somaReceitas &&
                "bg-red-700"
              }
              ${
                statusInfo &&
                statusInfo.mesAtual.somaReceitas >=
                  statusInfo?.mesAnterior.somaReceitas &&
                "bg-green-700"
              }
              ${
                statusInfo &&
                (statusInfo.mesAtual.somaReceitas /
                  statusInfo?.mesAnterior.somaReceitas) *
                  100 >=
                  50 &&
                "bg-yellow-700"
              }
              ${
                statusInfo &&
                (statusInfo.mesAtual.somaReceitas /
                  statusInfo?.mesAnterior.somaReceitas) *
                  100 >=
                  80 &&
                "bg-blue-700"
              }
              mb-1`}
            >
              {isLoadingStatus ? (
                <div className="h-4 flex items-center">
                  <Skeleton className="h-2 w-8"></Skeleton>
                </div>
              ) : (
                statusInfo &&
                handleFormatPercent(
                  statusInfo.mesAtual.somaReceitas,
                  statusInfo.mesAnterior.somaReceitas
                )
              )}
              {statusInfo &&
                statusInfo.mesAtual.somaReceitas <
                  statusInfo.mesAnterior.somaReceitas && <TrendingDown />}
              {statusInfo &&
                statusInfo.mesAtual.somaReceitas >=
                  statusInfo.mesAnterior.somaReceitas && <TrendingUp />}
            </Badge>
            <span>Mês anterior</span>
            {isLoadingStatus ? (
              <div className="h-4 flex items-center">
                <Skeleton className="h-2 w-15"></Skeleton>
              </div>
            ) : (
              <span className="w-fit text-muted-foreground">
                {statusInfo &&
                  formatarEmReal(statusInfo?.mesAnterior.somaReceitas)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
      <Card className="gap-1 py-4 h-full">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs lg:text-sm font-medium">
            Despesa total{" "}
            <span className="text-muted-foreground">(Este mês)</span>
          </CardTitle>
          <Package className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="flex flex-row justify-between">
          <div className="flex flex-col justify-between">
            <BanknoteArrowDown className="text-red-800 dark:text-red-200" />

            {isLoadingStatus ? (
              <div className="h-7 flex items-center">
                <Skeleton className="h-4 w-30"></Skeleton>
              </div>
            ) : (
              <span className="text-base lg:text-xl">
                {statusInfo &&
                  formatarEmReal(statusInfo?.mesAtual.somaDespesas)}
              </span>
            )}

            <p className="text-xs text-muted-foreground">Mensal</p>
          </div>
          <div className="flex flex-col items-end text-xs">
            <Badge
              className={`
              ${
                statusInfo &&
                statusInfo.mesAtual.somaDespesas <
                  statusInfo?.mesAnterior.somaDespesas &&
                "bg-green-700"
              }
              ${
                statusInfo &&
                statusInfo.mesAtual.somaDespesas >=
                  statusInfo?.mesAnterior.somaDespesas &&
                "bg-red-700"
              }
              ${
                statusInfo &&
                (statusInfo.mesAtual.somaDespesas /
                  statusInfo?.mesAnterior.somaDespesas) *
                  100 >=
                  50 &&
                "bg-yellow-700"
              }
              ${
                statusInfo &&
                (statusInfo.mesAtual.somaDespesas /
                  statusInfo?.mesAnterior.somaDespesas) *
                  100 >=
                  80 &&
                "bg-orange-700"
              }
              mb-1`}
            >
              {isLoadingStatus ? (
                <div className="h-4 flex items-center">
                  <Skeleton className="h-2 w-8"></Skeleton>
                </div>
              ) : (
                statusInfo &&
                handleFormatPercent(
                  statusInfo.mesAtual.somaDespesas,
                  statusInfo.mesAnterior.somaDespesas
                )
              )}

              {statusInfo &&
                statusInfo.mesAtual.somaDespesas <
                  statusInfo.mesAnterior.somaDespesas && <TrendingDown />}
              {statusInfo &&
                statusInfo.mesAtual.somaDespesas >=
                  statusInfo.mesAnterior.somaDespesas && <TrendingUp />}
            </Badge>
            <span>Mês anterior</span>
            {isLoadingStatus ? (
              <div className="h-4 flex items-center">
                <Skeleton className="h-2 w-15"></Skeleton>
              </div>
            ) : (
              <span className="w-fit text-muted-foreground">
                {statusInfo &&
                  formatarEmReal(statusInfo?.mesAnterior.somaDespesas)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
      <Card className="gap-1 py-4 h-full">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs lg:text-sm font-medium">
            Renda Líquida total{" "}
            <span className="text-muted-foreground">(Este mês)</span>
          </CardTitle>
          <Package className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="flex flex-row justify-between">
          <div className="flex flex-col justify-between">
            <Coins className="text-amber-800 dark:text-amber-200" />

            {isLoadingStatus ? (
              <div className="h-7 flex items-center">
                <Skeleton className="h-4 w-30"></Skeleton>
              </div>
            ) : (
              <span className="text-base lg:text-xl">
                {statusInfo &&
                  formatarEmReal(
                    statusInfo?.mesAtual.somaReceitas -
                      statusInfo?.mesAtual.somaDespesas
                  )}
              </span>
            )}

            <p className="text-xs text-muted-foreground">Mensal</p>
          </div>
          <div className="flex flex-col items-end text-xs">
            <Badge
              className={`
              ${
                statusInfo &&
                statusInfo.mesAtual.somaReceitas -
                  statusInfo.mesAtual.somaDespesas <
                  statusInfo?.mesAnterior.somaReceitas -
                    statusInfo?.mesAnterior.somaDespesas &&
                "bg-red-700"
              }
              ${
                statusInfo &&
                statusInfo.mesAtual.somaReceitas -
                  statusInfo.mesAtual.somaDespesas /
                    statusInfo?.mesAnterior.somaReceitas -
                  statusInfo?.mesAnterior.somaDespesas >
                  50 &&
                "bg-yellow-700"
              }
              ${
                statusInfo &&
                statusInfo.mesAtual.somaReceitas -
                  statusInfo.mesAtual.somaDespesas /
                    statusInfo?.mesAnterior.somaReceitas -
                  statusInfo?.mesAnterior.somaDespesas >
                  80 &&
                "bg-blue-700"
              }
              ${
                statusInfo &&
                statusInfo.mesAtual.somaReceitas -
                  statusInfo.mesAtual.somaDespesas >=
                  statusInfo?.mesAnterior.somaReceitas -
                    statusInfo?.mesAnterior.somaDespesas &&
                "bg-green-700"
              }
              
              mb-1`}
            >
              {isLoadingStatus ? (
                <div className="h-4 flex items-center">
                  <Skeleton className="h-2 w-8"></Skeleton>
                </div>
              ) : (
                statusInfo &&
                calcularVariacaoPercentual(
                  statusInfo.mesAtual.somaReceitas -
                    statusInfo.mesAtual.somaDespesas,
                  statusInfo.mesAnterior.somaReceitas -
                    statusInfo.mesAnterior.somaDespesas
                )
              )}
              {statusInfo &&
                statusInfo.mesAtual.somaReceitas -
                  statusInfo.mesAtual.somaDespesas <
                  statusInfo.mesAnterior.somaReceitas -
                    statusInfo.mesAnterior.somaDespesas && <TrendingDown />}
              {statusInfo &&
                statusInfo.mesAtual.somaReceitas -
                  statusInfo.mesAtual.somaDespesas >=
                  statusInfo.mesAnterior.somaReceitas -
                    statusInfo.mesAnterior.somaDespesas && <TrendingUp />}
            </Badge>
            <span>Mês anterior</span>
            {isLoadingStatus ? (
              <div className="h-4 flex items-center">
                <Skeleton className="h-2 w-15"></Skeleton>
              </div>
            ) : (
              <span className="w-fit text-muted-foreground">
                {statusInfo &&
                  formatarEmReal(
                    statusInfo?.mesAnterior.somaReceitas -
                      statusInfo?.mesAnterior.somaDespesas
                  )}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
