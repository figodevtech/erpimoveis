import { ReactNode } from "react";

/** Mesma classe de gatilho usada nos demais dialogs com abas do sistema. */
export const tabTriggerClass =
  "group h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm";

export const tabsListClass =
  "h-auto w-full justify-start gap-1.5 rounded-2xl border bg-muted/40 p-1 backdrop-blur-sm";

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
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="text-sm font-medium break-words">{children}</div>
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
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2 border-b pb-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {icone}
          {titulo}
        </div>
        {acao}
      </div>
      {children}
    </div>
  );
}

export function EstadoVazio({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
