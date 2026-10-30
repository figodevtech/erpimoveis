"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { permissionSetHas } from "@/app/api/_authz/permission-constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMediaQuery } from "@/hooks/use-media-query";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { type Entity, entityName, listFrom, titleCase } from "./model";

export async function requestJson(url: string, options?: RequestInit) {
  const response = await fetch(url, { ...options, headers: { ...(options?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...options?.headers }, cache: "no-store" });
  const result = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(result.error ?? result.message ?? `Não foi possível concluir a operação (${response.status}).`); Object.assign(error, { status: response.status, payload: result }); throw error; }
  return result;
}
export function useRemote<T = any>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion(value => value + 1), []);
  const loadedUrl = useRef<string | null>(null);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    // Recarregar o mesmo endereço mantém os dados na tela até a resposta nova chegar.
    if (loadedUrl.current !== url) setData(null);
    loadedUrl.current = url;
    setLoading(true); setError(null);
    requestJson(url, { signal: controller.signal }).then(setData).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, version]);
  return { data, loading, error, reload };
}
/** Load every page before exposing a calendar or a sale decision checklist. */
export function useAllPages(url: string | null) {
  const [data, setData] = useState<{ items: Entity[]; total: number } | null>(null);
  const [loading, setLoading] = useState(Boolean(url)); const [error, setError] = useState<string | null>(null); const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion(current => current + 1), []);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController(); setData(null); setLoading(true); setError(null);
    const load = async () => {
      const parsed = new URL(url, window.location.origin); parsed.searchParams.set("pageSize", "100"); parsed.searchParams.set("page", "1");
      const first = listFrom(await requestJson(parsed.pathname + parsed.search, { signal: controller.signal })); const rows = [...first.items];
      const size = first.pageSize || 100;
      for (let page = 2; (page - 1) * size < first.total; page += 1) {
        parsed.searchParams.set("page", String(page));
        const next = listFrom(await requestJson(parsed.pathname + parsed.search, { signal: controller.signal }));
        if (!next.items.length) throw new Error("A lista mudou durante a consulta. Atualize para carregar todas as operações.");
        rows.push(...next.items);
      }
      const unique = [...new Map(rows.map(row => [row.id, row])).values()];
      if (unique.length < first.total) throw new Error("A lista mudou durante a consulta. Atualize para carregar todas as operações.");
      if (!controller.signal.aborted) setData({ items: unique, total: first.total });
    };
    void load().catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, version]);
  return { data, loading, error, reload };
}
export function useModulePermission() {
  const { data: session, status } = useSession();
  const perms = (session?.user as { permissoes?: string[] } | undefined)?.permissoes;
  // Estável entre renderizações: as telas usam `can` nas dependências dos efeitos que buscam dados.
  const can = useCallback((permission: string) => permissionSetHas(perms, permission), [perms]);
  return { ready: status !== "loading", can };
}
export function RemoteState({ loading, error, retry, empty, children }: { loading?: boolean; error?: string | null; retry?: () => void; empty?: boolean; children?: ReactNode }) {
  if (loading) {
    return (
      <div role="status" className="flex h-full min-h-[300px] flex-1 flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
        <Loader2 className="size-6 animate-spin text-primary" />
        <span className="text-sm font-medium text-primary">Carregando…</span>
      </div>
    );
  }
  if (error) return <div role="alert" className="m-4 space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-5"><p className="flex gap-2 text-sm text-destructive"><AlertCircle className="size-4 shrink-0" />{error}</p>{retry ? <Button variant="outline" onClick={retry}><RefreshCw className="size-4" />Tentar novamente</Button> : null}</div>;
  if (empty) return <div className="m-4 rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Nenhum registro encontrado.</div>;
  return <>{children}</>;
}
export function StatusBadge({ status }: { status: unknown }) {
  const value = String(status ?? "").toUpperCase();
  if (!value || value === "—") return <Badge variant="outline">—</Badge>;

  if (["ATIVO", "DISPONIVEL", "CONFIRMADA", "CONCLUIDA", "PAGO", "ATIVA"].includes(value)) {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 font-medium text-[11px]">
        {titleCase(value)}
      </Badge>
    );
  }

  if (["PENDENTE", "EM_ANDAMENTO", "RESERVADO", "MANUTENCAO", "PARCIAL", "RASCUNHO"].includes(value)) {
    return (
      <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 font-medium text-[11px]">
        {titleCase(value)}
      </Badge>
    );
  }

  if (["INATIVO", "CANCELADA", "ENCERRADA", "ESTORNADO", "BLOQUEADO"].includes(value)) {
    return (
      <Badge variant="secondary" className="text-muted-foreground font-medium text-[11px]">
        {titleCase(value)}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="text-[11px]">
      {titleCase(value)}
    </Badge>
  );
}
export function Field({ label, children, hint, className = "" }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      <Label className="text-sm font-medium text-foreground">{label}</Label>
      {children}
      {hint ? <span className="text-xs text-muted-foreground block">{hint}</span> : null}
    </div>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  required,
  disabled,
  placeholder = "Selecione…",
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (string | { value: string; label: string })[];
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const normalizedOptions = options.map((option) => {
    const rawVal = typeof option === "string" ? option : option.value;
    const optLabel = typeof option === "string" ? titleCase(option) : option.label;
    return {
      rawVal,
      val: rawVal === "" ? "__EMPTY__" : rawVal,
      label: optLabel || placeholder,
    };
  });

  const hasEmptyOption = normalizedOptions.some((opt) => opt.rawVal === "");
  const currentVal = value === "" ? (hasEmptyOption ? "__EMPTY__" : undefined) : value;

  return (
    <div className={`space-y-2 ${className}`}>
      {label ? (
        <Label className="text-sm font-medium text-foreground">{label}</Label>
      ) : null}
      <Select
        disabled={disabled}
        required={required}
        value={currentVal}
        onValueChange={(next) => onChange(next === "__EMPTY__" ? "" : next)}
      >
        <SelectTrigger className="h-10 sm:h-11 w-full hover:cursor-pointer touch-manipulation">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {!hasEmptyOption && !required ? (
            <SelectItem value="__EMPTY__" className="text-muted-foreground hover:cursor-pointer">
              {placeholder}
            </SelectItem>
          ) : null}
          {normalizedOptions.map((opt) => (
            <SelectItem
              key={opt.val}
              value={opt.val}
              className="hover:cursor-pointer touch-manipulation"
            >
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function Lookup({
  tipo,
  label,
  value,
  onChange,
  initial,
  required = true,
  disabled = false,
}: {
  tipo: "clientes" | "proprietarios" | "imoveis" | "bancos";
  label: string;
  value: unknown;
  onChange: (value: number | null, item?: Entity) => void;
  initial?: Entity;
  required?: boolean;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const remote = useRemote<{ items: Entity[] }>(
    disabled
      ? null
      : `/api/imobiliario/lookup?tipo=${tipo}&search=${encodeURIComponent(term)}${
          value ? `&id=${value}` : ""
        }`
  );
  const rows = remote.data?.items ?? [];
  const options =
    value && !rows.some((row) => String(row.id) === String(value))
      ? [{ id: value, ...initial }, ...rows]
      : rows;

  const currentVal = value != null && value !== "" ? String(value) : undefined;

  return (
    <div className="space-y-1.5">
      {label ? (
        <span className="text-xs sm:text-sm font-medium text-foreground/90">{label}</span>
      ) : null}
      {!disabled ? (
        <Input
          aria-label={`Filtrar ${label.toLocaleLowerCase("pt-BR")}`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={`Filtrar ${label.toLowerCase()} por nome, código ou documento...`}
          className="h-11 sm:h-10 text-base sm:text-sm mb-1.5"
        />
      ) : null}
      <Select
        disabled={disabled || remote.loading}
        required={required}
        value={currentVal}
        onValueChange={(val) => {
          if (val === "__NONE__") {
            onChange(null, undefined);
          } else {
            const chosen = options.find((row) => String(row.id) === val);
            onChange(Number(val), chosen);
          }
        }}
      >
        <SelectTrigger className="h-11 sm:h-10 w-full rounded-lg border-input bg-background px-3 text-base sm:text-sm hover:cursor-pointer touch-manipulation">
          <SelectValue
            placeholder={
              remote.loading
                ? "Carregando opções…"
                : `Selecione ${label.toLowerCase()}…`
            }
          />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {!required ? (
            <SelectItem value="__NONE__" className="text-muted-foreground hover:cursor-pointer">
              Nenhum / Limpar seleção
            </SelectItem>
          ) : null}
          {options.map((row) => (
            <SelectItem
              key={String(row.id)}
              value={String(row.id)}
              className="hover:cursor-pointer touch-manipulation"
            >
              <span className="font-medium">{entityName(row)}</span>
              {row.cpfcnpj ? (
                <span className="text-xs text-muted-foreground font-mono ml-1.5">
                  ({row.cpfcnpj})
                </span>
              ) : row.titulo && row.id ? (
                <span className="text-xs text-muted-foreground font-mono ml-1.5">
                  #{row.id}
                </span>
              ) : null}
            </SelectItem>
          ))}
          {!options.length && !remote.loading ? (
            <div className="p-3 text-center text-xs text-muted-foreground">
              Nenhum registro encontrado
            </div>
          ) : null}
        </SelectContent>
      </Select>
      {remote.error ? (
        <p role="alert" className="text-xs text-destructive">
          {remote.error}{" "}
          <button type="button" className="underline" onClick={remote.reload}>
            Tentar novamente
          </button>
        </p>
      ) : null}
    </div>
  );
}

export function EntityShell({
  open,
  onOpenChange,
  title,
  description,
  badge,
  headerActions,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  headerActions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const shellContent = (
    <div className="relative flex h-full min-h-0 w-full min-w-0 max-w-full flex-col">
      {headerActions ? (
        <div className="absolute top-3 right-14 z-10 hidden sm:flex flex-row items-center gap-2">
          {headerActions}
        </div>
      ) : null}

      <div className="shrink-0 border-b px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-0.5 pr-20 sm:pr-0">
          <div className="flex flex-row items-center gap-2 text-sm sm:text-lg font-semibold">
            {title}
            {badge}
          </div>
          {description ? (
            <div className="text-xs text-muted-foreground">{description}</div>
          ) : null}
        </div>
        {headerActions ? (
          <div className="mt-2.5 flex sm:hidden items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            {headerActions}
          </div>
        ) : null}
      </div>

      <div className="flex-1 min-h-0 w-full min-w-0 overflow-hidden flex flex-col">
        {children}
      </div>

      {footer ? (
        <div className="shrink-0 border-t px-4 py-3 sm:px-6 bg-card/50">
          {footer}
        </div>
      ) : null}
    </div>
  );

  if (!isDesktop) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="h-[100dvh] w-screen max-w-none min-h-dvh mt-0 rounded-none max-h-none flex flex-col p-0 overflow-hidden">
          <DrawerTitle className="sr-only">Formulário de cadastro</DrawerTitle>
          <DrawerDescription className="sr-only">Dados cadastrais</DrawerDescription>
          {shellContent}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          className ||
          "h-svh w-[100dvw] max-w-[100dvw] p-0 overflow-hidden min-w-0 sm:max-w-[1100px] sm:max-h-[850px] sm:w-[95vw] sm:min-w-0"
        }
      >
        <DialogTitle className="sr-only">Formulário de cadastro</DialogTitle>
        <DialogDescription className="sr-only">Dados cadastrais</DialogDescription>
        {shellContent}
      </DialogContent>
    </Dialog>
  );
}
