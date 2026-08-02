// src/app/(app)/(pages)/meu-perfil/components/status-badge.tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { rotuloDeStatus } from "../lib/format";

/**
 * Mesma convencao cromatica das telas de OS (`bg-*-600/15`), com o tom de texto
 * ajustado para permanecer legivel no tema claro.
 */
const CLASSES_POR_STATUS: Record<string, string> = {
  // Ordem de serviço
  ORCAMENTO: "bg-fuchsia-600/15 text-fuchsia-700 dark:text-fuchsia-400",
  APROVACAO_ORCAMENTO: "bg-sky-600/15 text-sky-700 dark:text-sky-400",
  ORCAMENTO_APROVADO: "bg-sky-600/15 text-sky-700 dark:text-sky-400",
  ORCAMENTO_RECUSADO: "bg-red-600/15 text-red-700 dark:text-red-400",
  AGUARDANDO_CHECKLIST: "bg-sky-600/15 text-sky-700 dark:text-sky-400",
  EM_ANDAMENTO: "bg-amber-600/15 text-amber-700 dark:text-amber-400",
  PAGAMENTO: "bg-indigo-600/15 text-indigo-700 dark:text-indigo-400",
  SEM_COBRANCA: "bg-cyan-600/15 text-cyan-700 dark:text-cyan-400",
  CONCLUIDO: "bg-green-600/15 text-green-700 dark:text-green-400",
  CANCELADO: "bg-red-600/15 text-red-700 dark:text-red-400",

  // Venda
  ABERTA: "bg-amber-600/15 text-amber-700 dark:text-amber-400",
  PENDENTE: "bg-amber-600/15 text-amber-700 dark:text-amber-400",
  AUTORIZADO: "bg-green-600/15 text-green-700 dark:text-green-400",
  PAGO: "bg-green-600/15 text-green-700 dark:text-green-400",
  FINALIZADA: "bg-green-600/15 text-green-700 dark:text-green-400",
  CANCELADA: "bg-red-600/15 text-red-700 dark:text-red-400",

  // Execução do serviço (PENDENTE | EM_EXECUCAO | FINALIZADO)
  EM_EXECUCAO: "bg-blue-600/15 text-blue-700 dark:text-blue-400",
  FINALIZADO: "bg-green-600/15 text-green-700 dark:text-green-400",
};

const NEUTRO = "bg-muted text-muted-foreground";

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  const chave = String(status ?? "").toUpperCase();

  return (
    <Badge
      variant="outline"
      className={cn("border-transparent font-medium", CLASSES_POR_STATUS[chave] ?? NEUTRO, className)}
    >
      {rotuloDeStatus(status)}
    </Badge>
  );
}
