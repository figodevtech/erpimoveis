"use client";

import { FileInput, FileOutput, ReceiptText, WalletCards } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import formatarEmReal from "@/utils/formatarEmReal";

import type { FiscalKpis } from "../types";

type FiscalCardsProps = {
  kpis?: FiscalKpis;
  isLoading?: boolean;
};

function KpiCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: string;
  description: string;
  icon: typeof ReceiptText;
}) {
  return (
    <Card className="gap-2">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-base md:text-xl xl:text-2xl font-semibold">{value}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

export default function FiscalCards({ kpis, isLoading }: FiscalCardsProps) {
  const suffix = isLoading ? "Atualizando..." : "Indicador geral";

  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <KpiCard
        title="Notas próprias"
        value={String(kpis?.emitidasPorNos ?? 0)}
        description={suffix}
        icon={FileOutput}
      />
      <KpiCard
        title="Notas de terceiros"
        value={String(kpis?.emitidasTerceiros ?? 0)}
        description={suffix}
        icon={FileInput}
      />
      <KpiCard
        title="Valor próprias"
        value={formatarEmReal(kpis?.valorEmitidasPorNos ?? 0)}
        description={suffix}
        icon={ReceiptText}
      />
      <KpiCard
        title="Valor terceiros"
        value={formatarEmReal(kpis?.valorEmitidasTerceiros ?? 0)}
        description={suffix}
        icon={WalletCards}
      />
    </div>
  );
}
