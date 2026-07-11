"use client";

import { FileCheck2, FileInput, FileOutput, ReceiptText } from "lucide-react";

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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

export default function FiscalCards({ kpis, isLoading }: FiscalCardsProps) {
  const suffix = isLoading ? "Atualizando..." : "Notas fiscais no filtro atual";

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        title="Valor fiscal"
        value={formatarEmReal(kpis?.valorTotal ?? 0)}
        description={suffix}
        icon={ReceiptText}
      />
      <KpiCard
        title="Emissões próprias"
        value={String(kpis?.emitidasPorNos ?? 0)}
        description={formatarEmReal(kpis?.valorEmitidasPorNos ?? 0)}
        icon={FileOutput}
      />
      <KpiCard
        title="Emitidas por terceiros"
        value={String(kpis?.emitidasTerceiros ?? 0)}
        description={formatarEmReal(kpis?.valorEmitidasTerceiros ?? 0)}
        icon={FileInput}
      />
      <KpiCard
        title="Autorizadas"
        value={String(kpis?.autorizadas ?? 0)}
        description={`${kpis?.canceladas ?? 0} canceladas | ${kpis?.rejeitadas ?? 0} rejeitadas`}
        icon={FileCheck2}
      />
    </div>
  );
}
