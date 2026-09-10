"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Info, Loader2 } from "lucide-react";

/**
 * Primitivos visuais dos formulários de anúncio Mercado Livre. Criação e edição
 * compartilham os mesmos para que os dois diálogos não divirjam no visual.
 */

export const listingFieldClass =
  "w-full min-w-0 border-border/80 bg-white shadow-sm ring-1 ring-border/50 focus-visible:border-primary/50 focus-visible:ring-primary/20 dark:bg-input/40";
export const listingErrorClass =
  "border-destructive ring-destructive/40 focus-visible:border-destructive focus-visible:ring-destructive/30";

export function withError(error?: string) {
  return `${listingFieldClass} ${error ? listingErrorClass : ""}`;
}

export function StepHeading({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
        {number}
      </span>
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-2">
      {required ? <RequiredLabel>{label}</RequiredLabel> : <Label>{label}</Label>}
      {children}
    </div>
  );
}

export function RequiredLabel({ children }: { children: ReactNode }) {
  return (
    <Label>
      {children}
      <span className="ml-1 text-destructive">*</span>
    </Label>
  );
}

export function AttributeGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold">{title}</h3>
        <Badge variant="secondary">{count}</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function AttributeCard({ id, name, required, role, hint, error, children }: {
  id: string;
  name: string;
  required?: boolean;
  role?: string | null;
  hint?: string | null;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex min-h-[112px] min-w-0 flex-col gap-2 rounded-lg border p-3 ${error ? "border-destructive bg-destructive/5" : "bg-background"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Label className="leading-5">{name}{required ? <span className="ml-1 text-destructive">*</span> : null}</Label>
        <div className="flex flex-wrap items-center gap-1">
          {role && role !== "standard" ? <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{role === "parent" ? "Família" : role === "child" ? "Variação" : "Variável"}</Badge> : null}
          <span className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{id}</span>
        </div>
      </div>
      {children}
      {error ? <FieldError>{error}</FieldError> : null}
      {hint ? <p className="line-clamp-2 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function FieldError({ children }: { children: ReactNode }) {
  return <p className="text-xs text-destructive">{children}</p>;
}

export function MaybeError({ value }: { value?: string }) {
  return value ? <FieldError>{value}</FieldError> : null;
}

export function InfoBox({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 rounded-lg border border-blue-500/25 bg-blue-500/10 p-3 text-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
      <div>{children}</div>
    </div>
  );
}

export function LoadingBox({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {children}
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{children}</div>
  );
}

export function Summary({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={`rounded-lg border bg-background ${compact ? "px-3 py-2" : "p-3"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium">{value || "-"}</p>
    </div>
  );
}

/** Bloco de seção usado pelas etapas para agrupar campos afins. */
export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4 rounded-xl border bg-card p-4 shadow-sm">
      <div>
        <h3 className="font-semibold">{title}</h3>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}
