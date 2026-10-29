"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Chrome visual compartilhado dos diálogos de emissão fiscal.
 *
 * Extraído do diálogo de NFS-e para que NF-e e NFS-e falem a mesma língua:
 * tela cheia no celular, geometria reta (`rounded-sm`), cabeçalho com marcador
 * de etapa e faixas de seção numeradas.
 *
 * O indicador de etapas aqui é **informativo**, não um portão: na NF-e todas as
 * seções ficam visíveis ao mesmo tempo e podem ser preenchidas em qualquer
 * ordem. Ele mostra o que já está resolvido, sem bloquear passo algum.
 */

/** Classe do DialogContent: full-screen no mobile, painel contido no desktop. */
export const FISCAL_DIALOG_CONTENT_CLASS =
  "flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 "
  + "[&>[data-slot=dialog-close]]:grid [&>[data-slot=dialog-close]]:size-11 [&>[data-slot=dialog-close]]:place-items-center "
  + "sm:h-[min(92dvh,880px)] sm:w-[calc(100vw-2rem)] sm:max-w-[1180px] sm:rounded-sm sm:border";

export type EtapaFiscal = {
  rotulo: string;
  /** Concluída = sem pendências. Controla o preenchimento do marcador. */
  concluida: boolean;
};

export function IndicadorEtapas({ etapas }: { etapas: EtapaFiscal[] }) {
  const concluidas = etapas.filter((etapa) => etapa.concluida).length;

  return (
    <ol
      className="flex flex-wrap items-center gap-x-2 gap-y-1"
      aria-label={`${concluidas} de ${etapas.length} etapas sem pendências`}
    >
      {etapas.map((etapa, index) => (
        <li key={etapa.rotulo} className="flex items-center gap-2">
          <span
            className={`grid size-5 shrink-0 place-items-center border text-[10px] font-bold ${
              etapa.concluida
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-muted-foreground/40 text-muted-foreground"
            }`}
            aria-hidden="true"
          >
            {etapa.concluida ? <Check className="size-3" /> : index + 1}
          </span>
          <span
            className={`text-[11px] font-medium ${
              etapa.concluida ? "text-muted-foreground" : "text-foreground"
            }`}
          >
            {etapa.rotulo}
          </span>
          {index < etapas.length - 1 ? (
            <span aria-hidden="true" className="hidden h-px w-4 bg-border sm:block" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function CabecalhoFiscal({
  icone,
  eyebrow,
  titulo,
  descricao,
  badge,
  etapas,
  meta,
}: {
  icone: ReactNode;
  eyebrow: string;
  titulo: string;
  descricao: string;
  badge?: ReactNode;
  etapas?: EtapaFiscal[];
  meta?: ReactNode;
}) {
  return (
    <div className="shrink-0 border-b bg-card pb-5 pl-5 pr-16 pt-[max(1.25rem,env(safe-area-inset-top))] text-left sm:pl-7 sm:pt-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center border-2 border-primary bg-primary/10 text-primary">
            {icone}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">{eyebrow}</p>
              {badge}
            </div>
            <h2 className="mt-1 break-words text-lg font-bold leading-snug">{titulo}</h2>
            <p className="mt-1 break-words text-sm text-muted-foreground">{descricao}</p>
          </div>
        </div>
        {etapas?.length ? (
          <div className="w-full lg:max-w-md">
            <IndicadorEtapas etapas={etapas} />
          </div>
        ) : null}
      </div>
      {meta ? (
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4 text-xs text-muted-foreground">
          {meta}
        </div>
      ) : null}
    </div>
  );
}

/** Esqueleto de carregamento, no lugar do spinner solto. */
export function EsqueletoFiscal() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Preparando os dados da emissão…</span>
      {[0, 1, 2].map((bloco) => (
        <div key={bloco} className="border border-l-4 border-l-border bg-card p-4">
          <Skeleton className="h-3 w-24 rounded-sm" />
          <Skeleton className="mt-2 h-5 w-56 rounded-sm" />
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-10 rounded-sm" />
            <Skeleton className="h-10 rounded-sm" />
            <Skeleton className="h-10 rounded-sm" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Barra de ação fixa no rodapé, sempre alcançável sem rolar. */
export function BarraAcaoFiscal({ resumo, acoes }: { resumo: ReactNode; acoes: ReactNode }) {
  return (
    <div className="shrink-0 border-t bg-card px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_12px_-8px_rgba(0,0,0,0.3)] sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-sm">{resumo}</div>
        <div className="flex min-w-0 flex-col gap-2 sm:shrink-0 sm:flex-row">{acoes}</div>
      </div>
    </div>
  );
}
