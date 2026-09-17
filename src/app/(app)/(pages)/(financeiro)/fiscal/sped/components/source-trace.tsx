"use client";

import { Database, FileCode2, Fingerprint } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import type { SpedSourceReference } from "../types";

export function SourceTrace({ sources }: { sources: SpedSourceReference[] }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="h-8 gap-1.5 px-2">
          <Database aria-hidden="true" />
          Origem
          <span className="sr-only">dos dados</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Rastreabilidade da informação</DialogTitle>
          <DialogDescription>
            Fontes congeladas ou operacionais usadas para compor este valor na escrituração.
          </DialogDescription>
        </DialogHeader>

        {sources.length ? (
          <div className="space-y-3">
            {sources.map((source, index) => (
              <div key={`${source.tipo}-${source.registroId ?? index}`} className="rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <FileCode2 className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span>{source.descricao || source.tipo}</span>
                </div>
                <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                  <TraceField label="Tipo" value={source.tipo} />
                  <TraceField label="Tabela" value={source.tabela} />
                  <TraceField label="Registro" value={source.registroId} mono />
                  <TraceField label="Campo" value={source.campo} mono />
                  <TraceField label="Documento" value={source.documento} mono wide />
                  <TraceField label="Hash" value={source.hash} mono wide />
                </dl>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-32 flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center">
            <Fingerprint className="mb-2 size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">Origem não informada</p>
            <p className="mt-1 text-xs text-muted-foreground">
              A competência não pode ser fechada enquanto um valor fiscal obrigatório não tiver fonte rastreável.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TraceField({
  label,
  value,
  mono = false,
  wide = false,
}: {
  label: string;
  value?: string | number | null;
  mono?: boolean;
  wide?: boolean;
}) {
  if (value === null || value === undefined || value === "") return null;

  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "break-all font-mono text-[11px]" : "break-words"}>{String(value)}</dd>
    </div>
  );
}
