import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { transactionFormSurfaceClass } from "../transaction-dialog-ui";

/** Mesma classe de gatilho usada nos demais dialogs com abas do sistema. */
export const tabTriggerClass =
  "group relative h-11 min-w-fit flex-1 shrink-0 rounded-none border-r border-border px-4 text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground shadow-none transition-colors last:border-r-0 hover:cursor-pointer hover:bg-muted/50 hover:text-foreground data-[state=active]:border-b-2 data-[state=active]:border-b-primary data-[state=active]:bg-primary/10 data-[state=active]:text-primary";

export const tabsListClass =
  "flex h-auto w-full justify-start overflow-x-auto rounded-none border-0 bg-background p-0";

const EMPTY = "—";

export function fmtDate(value?: string | Date | null) {
  if (!value) return EMPTY;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return date.toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" });
}

export function fmtDateTime(value?: string | Date | null) {
  if (!value) return EMPTY;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return date.toLocaleString("pt-BR", {
    timeZone: "America/Fortaleza",
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function fmtText(value?: string | number | null) {
  if (value == null) return EMPTY;
  const text = String(value).trim();
  return text ? text : EMPTY;
}

export function fmtPhone(value?: string | null) {
  if (!value) return EMPTY;
  const digits = String(value).replace(/\D/g, "");
  if (digits.length === 11) return digits.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (digits.length === 10) return digits.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return value;
}

export function joinParts(parts: Array<string | null | undefined>, separator = ", ") {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(separator);
}

/** Par rotulo/valor no mesmo formato usado nos cartoes dos outros dialogs. */
export function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground sm:text-[10px]">
        {label}
      </p>
      <div className="break-words text-sm font-semibold text-foreground">{children}</div>
    </div>
  );
}

export function Cartao({
  titulo,
  icone,
  children,
  acao,
}: {
  titulo: string;
  icone?: ReactNode;
  children: ReactNode;
  acao?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden border border-border bg-card shadow-sm",
        transactionFormSurfaceClass,
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border bg-muted/25 px-4 py-3">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.1em] text-foreground">
          {icone}
          {titulo}
        </div>
        {acao}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function EstadoVazio({ children }: { children: ReactNode }) {
  return (
    <div className="border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
