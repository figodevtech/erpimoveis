"use client";

import { JSX, useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import {
  ClipboardList,
  ClipboardCheck,
  Loader2,
  CreditCard,
  CheckCircle2,
  XCircle,
  BarChart3,
  ChevronDown,
} from "lucide-react";
import { OrdensTabela } from "./ordens-tabela";
import { Button } from "@/components/ui/button";
import { useRealtimeTabelas } from "@/hooks/use-realtime-tabelas";
import { STATUS_OS_VALIDOS, type StatusOSValido } from "@/lib/ordens/destaque";

/** Módulo, não literal: um array novo a cada render reiniciaria a inscrição. */
const TABELAS_REALTIME = ["ordemservico"];

/**
 * Status que existem no banco. A lista mora em @/lib/ordens/destaque porque a
 * API de config tambem precisa dela para validar os destaques por status, e uma
 * route nao pode importar deste arquivo, que e "use client".
 */
export type StatusOS = StatusOSValido;

/** Chaves das abas da UI */
type TabKey =
  | "ABERTAS"
  | "ORCAMENTO"
  | "APROVACAO"
  | "EM_ANDAMENTO"
  | "PAGAMENTO"
  | "FINALIZADAS";

/** Lista completa (sem duplicar e sem faltar) */
const ALL_STATUSES: StatusOS[] = [...STATUS_OS_VALIDOS];

/** Default com zeros (pra nÃ£o depender do backend mandar chave com 0) */
type OrdemStats = Record<StatusOS, number>;

const DEFAULT_STATS: OrdemStats = ALL_STATUSES.reduce((acc, s) => {
  acc[s] = 0;
  return acc;
}, {} as OrdemStats);

/** Abertas = tudo exceto finalizadas */
const OPEN_STATUSES: StatusOS[] = [
  "AGUARDANDO_CHECKLIST",
  "ORCAMENTO",
  "ORCAMENTO_RECUSADO",
  "APROVACAO_ORCAMENTO",
  "ORCAMENTO_APROVADO",
  "EM_ANDAMENTO",
  "PAGAMENTO",
  "FATURAMENTO",
];

const statusTabs: {
  key: TabKey;
  label: string;
  icon: JSX.Element;
  dot: string;
  active: string;
  statuses: StatusOS[];
}[] = [
  {
    key: "ABERTAS",
    label: "Abertas",
    icon: <ClipboardList className="h-4 w-4" />,
    dot: "bg-violet-500",
    active:
      "data-[state=active]:bg-violet-600/15 data-[state=active]:text-violet-700 data-[state=active]:ring-violet-500/30",
    statuses: OPEN_STATUSES,
  },
  {
    key: "ORCAMENTO",
    label: "Orçamento",
    icon: <ClipboardList className="h-4 w-4" />,
    dot: "bg-fuchsia-500",
    active:
      "data-[state=active]:bg-fuchsia-500/15 data-[state=active]:text-fuchsia-800 data-[state=active]:ring-fuchsia-500/30",
    statuses: ["ORCAMENTO", "ORCAMENTO_RECUSADO", "AGUARDANDO_CHECKLIST"],
  },
  {
    key: "APROVACAO",
    label: "Aprovação",
    icon: <ClipboardCheck className="h-4 w-4" />,
    dot: "bg-sky-500",
    active:
      "data-[state=active]:bg-sky-500/15 data-[state=active]:text-sky-800 data-[state=active]:ring-sky-500/30",
    statuses: ["APROVACAO_ORCAMENTO", "ORCAMENTO_APROVADO"],
  },
  {
    key: "EM_ANDAMENTO",
    label: "Em Andamento",
    icon: <Loader2 className="h-4 w-4" />,
    dot: "bg-amber-500",
    active:
      "data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-800 data-[state=active]:ring-amber-500/30",
    statuses: ["EM_ANDAMENTO"],
  },
  {
    key: "PAGAMENTO",
    label: "Pagamento",
    icon: <CreditCard className="h-4 w-4" />,
    dot: "bg-indigo-500",
    active:
      "data-[state=active]:bg-indigo-500/15 data-[state=active]:text-indigo-800 data-[state=active]:ring-indigo-500/30",
    statuses: ["PAGAMENTO", "FATURAMENTO"],
  },
  {
    key: "FINALIZADAS",
    label: "Finalizadas",
    icon: <CheckCircle2 className="h-4 w-4" />,
    dot: "bg-emerald-600",
    active:
      "data-[state=active]:bg-emerald-600/15 data-[state=active]:text-emerald-800 data-[state=active]:ring-emerald-600/30",
    statuses: ["CONCLUIDO", "SEM_COBRANCA", "CANCELADO"],
  },
];

function sumByStatuses(stats: Record<StatusOS, number>, statuses: StatusOS[]) {
  return statuses.reduce((sum, s) => sum + (stats[s] || 0), 0);
}

export function OrdensTabs({
  onOpenOrcamento,
  onEditar,
  onNovaOS,
}: {
  onOpenOrcamento: (row: any) => void;
  onEditar: (row: any) => void;
  onNovaOS: () => void;
}) {
  const [active, setActive] = useState<TabKey>("ABERTAS");
  const [stats, setStats] = useState<OrdemStats>(DEFAULT_STATS);
  const [showSummaryMobile, setShowSummaryMobile] = useState(false);

  // Total deve bater com a aba ABERTAS (abertas == OPEN_STATUSES)
  const totalAbertas = useMemo(() => sumByStatuses(stats, OPEN_STATUSES), [stats]);

  const loadStats = async () => {
    try {
      const r = await fetch("/api/ordens/stats", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return;

      const counters = (j?.counters ?? {}) as Partial<OrdemStats>;

      // merge: nÃ£o perder chaves quando API nÃ£o manda (useState nÃ£o faz merge). [web:395][web:394]
      setStats({ ...DEFAULT_STATS, ...counters });
    } catch {}
  };

  useEffect(() => {
    void Promise.resolve().then(loadStats);
  }, []);

  // Realtime contadores — mesmo canal que a tabela de ordens usa.
  useRealtimeTabelas(TABELAS_REALTIME, loadStats);

  return (
    <div className="space-y-4">
      {/* BotÃ£o para mostrar/ocultar resumo no mobile */}
      <div className="sm:hidden">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-between"
          aria-controls="os-summary-grid"
          aria-expanded={showSummaryMobile}
          onClick={() => setShowSummaryMobile((s) => !s)}
        >
          <span className="inline-flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Resumo
          </span>
          <ChevronDown className={`h-4 w-4 transition-transform ${showSummaryMobile ? "rotate-180" : ""}`} />
        </Button>

        {showSummaryMobile && (
          <div id="os-summary-grid" className="mt-2">
            <SummaryGrid totalAbertas={totalAbertas} stats={stats} />
          </div>
        )}
      </div>

      {/* Resumo sempre visÃ­vel em sm+ */}
      <div className="hidden sm:block">
        <SummaryGrid totalAbertas={totalAbertas} stats={stats} />
      </div>

      <Tabs value={active} onValueChange={(v) => setActive(v as TabKey)} className="w-full">
        <TabsList
          className={[
            "w-full overflow-x-auto justify-start gap-2",
            "rounded-lg px-1 py-1",
            "bg-violet-50/80 supports-[backdrop-filter]:backdrop-blur",
            "ring-1 ring-violet-200/80",
          ].join(" ")}
        >
          {statusTabs.map((t) => (
            <TabsTrigger
              key={t.key}
              value={t.key}
              className={[
                "whitespace-nowrap px-3 py-1.5 rounded-md text-xs md:text-sm",
                "ring-1 ring-transparent transition-colors",
                "hover:bg-violet-100/70",
                t.active,
              ].join(" ")}
            >
              <span className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${t.dot}`} />
                {t.icon}
                <span>{t.label}</span>
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        {statusTabs.map((t) => (
          <TabsContent key={t.key} value={t.key} className="mt-3">
            <OrdensTabela
              statuses={t.statuses}
              onOpenOrcamento={onOpenOrcamento}
              onEditar={onEditar}
              onNovaOS={onNovaOS}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function SummaryGrid({
  totalAbertas,
  stats,
}: {
  totalAbertas: number;
  stats: OrdemStats;
}) {
  // Cards calculados do MESMO jeito que as abas (pra sempre bater)
  const tabOrcamento = statusTabs.find((t) => t.key === "ORCAMENTO")!.statuses;
  const tabAprovacao = statusTabs.find((t) => t.key === "APROVACAO")!.statuses;
  const tabEmAndamento = statusTabs.find((t) => t.key === "EM_ANDAMENTO")!.statuses;
  const tabPagamento = statusTabs.find((t) => t.key === "PAGAMENTO")!.statuses;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-8 gap-2">
      <MiniCard
        accent="text-violet-700 dark:text-violet-300"
        title="Total (Abertas)"
        value={totalAbertas}
        icon={<ClipboardList className="h-4 w-4" />}
      />

      <MiniCard
        accent="text-fuchsia-700 dark:text-fuchsia-300"
        title="Orçamento"
        value={sumByStatuses(stats, tabOrcamento)} // inclui AGUARDANDO_CHECKLIST
        icon={<ClipboardList className="h-4 w-4" />}
      />

      <MiniCard
        accent="text-sky-700 dark:text-sky-300"
        title="Aprovação"
        value={sumByStatuses(stats, tabAprovacao)} // inclui ORCAMENTO_APROVADO
        icon={<ClipboardCheck className="h-4 w-4" />}
      />

      <MiniCard
        accent="text-amber-700 dark:text-amber-300"
        title="Em Andamento"
        value={sumByStatuses(stats, tabEmAndamento)}
        icon={<Loader2 className="h-4 w-4" />}
      />

      <MiniCard
        accent="text-indigo-700 dark:text-indigo-300"
        title="Pagamento"
        value={sumByStatuses(stats, tabPagamento)}
        icon={<CreditCard className="h-4 w-4" />}
      />

      <MiniCard
        accent="text-emerald-700 dark:text-emerald-300"
        title="Concluído "
        value={stats.CONCLUIDO || 0}
        icon={<CheckCircle2 className="h-4 w-4" />}
      />


      <MiniCard
        accent="text-cyan-700 dark:text-cyan-300"
        title="Sem cobrança"
        value={stats.SEM_COBRANCA || 0}
        icon={<CheckCircle2 className="h-4 w-4" />}
      />
      <MiniCard
        accent="text-rose-700 dark:text-rose-300"
        title="Cancelado"
        value={stats.CANCELADO || 0}
        icon={<XCircle className="h-4 w-4" />}
      />
    </div>
  );
}

function MiniCard({
  title,
  value,
  icon,
  accent,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <Card className="bg-card py-4">
      <CardContent className="p-2 sm:p-3">
        <div className="flex items-center justify-between text-[10px] sm:text-xs text-muted-foreground">
          <span className="truncate leading-tight">{title}</span>
          <span
            className={["shrink-0", accent, "[&>svg]:h-3 [&>svg]:w-3 sm:[&>svg]:h-4 sm:[&>svg]:w-4"]
              .filter(Boolean)
              .join(" ")}
          >
            {icon}
          </span>
        </div>
        <div className="text-lg sm:text-xl font-semibold tabular-nums leading-snug">{value}</div>
      </CardContent>
    </Card>
  );
}
