"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertTriangle, Sparkles } from "lucide-react";

export function ListingDialogContent({ mode, stepCount, notice, children }: {
  mode: "create" | "edit";
  stepCount: number;
  notice?: string;
  children: ReactNode;
}) {
  const creating = mode === "create";

  return (
    <DialogContent
      onPointerDownOutside={(event) => event.preventDefault()}
      className="flex h-[100dvh] max-h-[100dvh] w-[100dvw] max-w-[100dvw] flex-col gap-0 overflow-hidden rounded-none border-0 border-border/70 p-0 shadow-2xl sm:h-[900px] sm:max-h-[94dvh] sm:w-[96vw] sm:max-w-6xl sm:rounded-2xl sm:border"
    >
      <DialogHeader className="relative shrink-0 overflow-hidden border-b border-amber-300/40 bg-gradient-to-r from-[#fff159] via-[#ffe600] to-[#ffd600] px-4 py-2.5 pr-12 text-left dark:from-amber-400 dark:via-yellow-400 dark:to-amber-500 sm:px-6 sm:py-3 sm:pr-12">
        <div className="pointer-events-none absolute -right-8 -top-16 h-40 w-40 rounded-full bg-white/30 blur-2xl" />
        <div className="relative flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/85 text-[#2d3277] shadow-sm ring-1 ring-black/5 sm:h-10 sm:w-10">
            <Sparkles className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 sm:mb-0.5">
              <DialogTitle className="text-base text-[#252a52] sm:text-lg">
                {creating ? "Criar" : "Editar"} anúncio Mercado Livre
              </DialogTitle>
              {notice ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label="Ver restrições de edição do Mercado Livre"
                      title={notice}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#252a52] hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#252a52]"
                    >
                      <AlertTriangle className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="max-w-[calc(100vw-2rem)] text-sm">
                    {notice}
                  </PopoverContent>
                </Popover>
              ) : null}
              <Badge className="hidden shrink-0 border-0 bg-[#3483fa] text-[10px] text-white shadow-none hover:bg-[#3483fa] sm:inline-flex">
                {creating ? "NOVO ANÚNCIO" : "EDITAR ANÚNCIO"}
              </Badge>
            </div>
            <DialogDescription className="sr-only text-xs text-[#454b6b] sm:not-sr-only sm:block">
              {creating ? "Preencha" : "Atualize"} os dados do anúncio em {stepCount} etapas e {creating ? "publique" : "salve as alterações"} no Mercado Livre.
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>
      {children}
    </DialogContent>
  );
}
