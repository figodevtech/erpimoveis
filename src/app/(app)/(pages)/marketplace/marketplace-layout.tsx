"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, MessageCircle, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarketplaceChannelSwitcher } from "./marketplace-channel";

export type MarketplaceSectionItem<T extends string = string> = {
  value: T;
  label: string;
  icon: LucideIcon;
  count?: number;
  attention?: boolean;
};

export function useMarketplaceSection<T extends string>(allowed: readonly T[], fallback: T) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("secao");
  const requestedSection = allowed.includes(requested as T) ? requested as T : fallback;
  const [section, setSectionState] = useState<T>(requestedSection);

  useEffect(() => {
    setSectionState(requestedSection);
  }, [requestedSection]);

  const setSection = useCallback((nextSection: T) => {
    setSectionState(nextSection);
    const params = new URLSearchParams(searchParams.toString());
    params.set("secao", nextSection);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  return [section, setSection] as const;
}

export function useMarketplaceQueryValue(key: string, fallback = "") {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get(key) ?? fallback;
  const [value, setValueState] = useState(requested);

  useEffect(() => { setValueState(requested); }, [requested]);

  const setValue = useCallback((nextValue: string) => {
    setValueState(nextValue);
    const params = new URLSearchParams(searchParams.toString());
    if (!nextValue || nextValue === fallback) params.delete(key);
    else params.set(key, nextValue);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [fallback, key, pathname, router, searchParams]);

  return [value, setValue] as const;
}

export function MarketplaceHeader({
  icon: Icon,
  iconClassName,
  description,
  connected,
  accountName,
  accountDescription,
  accountBadge,
}: {
  icon: LucideIcon;
  iconClassName: string;
  description: string;
  connected: boolean;
  accountName: string;
  accountDescription: string;
  accountBadge?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-card shadow-sm">
          <Icon className={`h-5 w-5 ${iconClassName}`} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Marketplace</h1>
          <p className="truncate text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <MarketplaceChannelSwitcher />
        <div className="flex min-w-0 items-center gap-3 rounded-md border bg-card px-3 py-2 shadow-sm">
          <span className={`h-2 w-2 shrink-0 rounded-full ${connected ? "bg-emerald-500" : "bg-orange-500"}`} />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm font-medium">{accountName}</p>
              {accountBadge ? (
                <span className="shrink-0">{accountBadge}</span>
              ) : null}
            </div>
            <p className="truncate text-xs text-muted-foreground">{accountDescription}</p>
          </div>
          {connected ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : null}
        </div>
      </div>
    </header>
  );
}

export function MarketplaceSectionNav<T extends string>({ items, trailing }: {
  items: Array<MarketplaceSectionItem<T>>;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-10 min-w-0 gap-2 px-3 pt-3 sm:px-6 md:grid-cols-[1fr_auto_1fr] md:items-center">
      <div className="min-w-0 max-w-full overflow-x-auto md:col-start-2">
        <TabsList className="mx-auto h-auto min-w-max justify-start gap-1 rounded-xl border bg-muted/40 p-1">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <TabsTrigger key={item.value} value={item.value} className="h-8 gap-1.5 rounded-lg border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">
                <Icon className="h-3.5 w-3.5" />
                {item.label}
                {item.count !== undefined ? (
                  <span className={`rounded px-1 text-[10px] tabular-nums ${item.attention ? "bg-rose-500/20" : "bg-background/20"}`}>{item.count}</span>
                ) : null}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>
      {trailing ? <div className="flex w-full shrink-0 self-end justify-self-end md:col-start-3 md:w-auto md:self-auto">{trailing}</div> : null}
    </div>
  );
}

export function MarketplaceListToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  filter,
  onFilterChange,
  filterLabel = "Situação",
  filterOptions,
  resultLabel,
  actions,
  embedded = false,
  compact = false,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  filter?: string;
  onFilterChange?: (value: string) => void;
  filterLabel?: string;
  filterOptions?: Array<{ value: string; label: string }>;
  resultLabel?: string;
  actions?: React.ReactNode;
  embedded?: boolean;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 lg:flex-nowrap">
        <div className="relative w-full min-w-[220px] sm:w-[320px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={searchPlaceholder} className="h-9 bg-background pl-9" />
        </div>
        {filter !== undefined && onFilterChange && filterOptions?.length ? (
          <Select value={filter} onValueChange={onFilterChange}>
            <SelectTrigger className="h-9 w-full bg-background sm:w-52" aria-label={filterLabel}><SelectValue placeholder={filterLabel} /></SelectTrigger>
            <SelectContent>{filterOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        ) : null}
        {actions}
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between ${embedded ? "" : "border-b bg-muted/10 p-4"}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
        <div className="relative w-full sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={searchPlaceholder} className="bg-background pl-9" />
        </div>
        {filter !== undefined && onFilterChange && filterOptions?.length ? (
          <Select value={filter} onValueChange={onFilterChange}>
            <SelectTrigger className="w-full bg-background sm:w-52" aria-label={filterLabel}><SelectValue placeholder={filterLabel} /></SelectTrigger>
            <SelectContent>{filterOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 lg:justify-end">
        {resultLabel ? <p className="text-xs text-muted-foreground">{resultLabel}</p> : null}
        {actions}
      </div>
    </div>
  );
}

export function MarketplaceLoadingLine({ loading }: { loading: boolean }) {
  return (
    <div className="relative z-10 -mt-0.5 h-0.5 w-full overflow-hidden" aria-hidden={!loading}>
      <div className={`absolute inset-0 bg-slate-300/70 transition-opacity dark:bg-slate-700/70 ${loading ? "opacity-100" : "opacity-0"}`}>
        <div className={`absolute left-0 h-full w-1/2 -translate-x-full rounded-full bg-primary ${loading ? "animate-slideIn" : ""}`} />
      </div>
    </div>
  );
}

export function MarketplacePagination({ page, totalPages, pageSize, total, visible, onPageChange, onPageSizeChange }: {
  page: number;
  totalPages: number;
  pageSize: number;
  total: number;
  visible: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = total === 0 ? 0 : start + visible - 1;
  return (
    <div className="grid min-h-14 grid-cols-1 items-center gap-3 border-t bg-muted/10 px-4 py-3 sm:grid-cols-[1fr_auto_1fr]">
      <p className="justify-self-center text-xs text-muted-foreground sm:justify-self-start">{start} - {end}<span className="ml-1">de {total}</span></p>
      <div className="flex items-center justify-center gap-1 sm:col-start-2 sm:row-start-1 sm:gap-2">
        <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label="Primeira página" disabled={page <= 1} onClick={() => onPageChange(1)}><ChevronsLeft className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label="Página anterior" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
        <span className="min-w-20 text-center text-xs font-medium">Pg. {page} de {totalPages}</span>
        <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label="Próxima página" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label="Última página" disabled={page >= totalPages} onClick={() => onPageChange(totalPages)}><ChevronsRight className="h-4 w-4" /></Button>
      </div>
      <div className="flex items-center justify-center gap-2 sm:col-start-3 sm:row-start-1 sm:justify-self-end">
        <span className="hidden text-xs text-muted-foreground sm:inline">Exibir:</span>
        <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
          <SelectTrigger className="h-8 w-20 bg-background text-xs" aria-label="Itens por página"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="20">20</SelectItem><SelectItem value="50">50</SelectItem><SelectItem value="100">100</SelectItem></SelectContent>
        </Select>
      </div>
    </div>
  );
}

export function MarketplaceChatLauncher({ label = "Atendimento", unreadCount = 0, disabled, onClick }: {
  label?: string;
  unreadCount?: number;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button type="button" className="fixed bottom-5 right-5 z-40 h-12 rounded-full px-4 shadow-lg" onClick={onClick} disabled={disabled} aria-label={`Abrir ${label.toLocaleLowerCase("pt-BR")}`}>
      <MessageCircle className="mr-2 h-5 w-5" />{label}
      {unreadCount > 0 ? <Badge className="ml-2 bg-amber-500 text-white hover:bg-amber-500">{unreadCount}</Badge> : null}
    </Button>
  );
}

export type MarketplaceAttentionItem = {
  id: string;
  title: string;
  description: string;
  count?: number;
  tone?: "warning" | "danger";
  actionLabel: string;
  onAction: () => void;
};

export function MarketplaceAttentionCenter({ items }: { items: MarketplaceAttentionItem[] }) {
  return (
    <div className="rounded-lg border p-5">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-sm font-semibold">Central de pendências</p><p className="text-xs text-muted-foreground">Ações que precisam de acompanhamento.</p></div>
        <Badge variant={items.length ? "destructive" : "secondary"}>{items.length}</Badge>
      </div>
      {items.length ? <div className="mt-4 divide-y">{items.map((item) => (
        <div key={item.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
          <div className="flex min-w-0 gap-2.5">
            <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${item.tone === "danger" ? "text-destructive" : "text-amber-600"}`} />
            <div className="min-w-0"><p className="text-sm font-medium">{item.title}{item.count !== undefined ? ` (${item.count})` : ""}</p><p className="text-xs text-muted-foreground">{item.description}</p></div>
          </div>
          <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" onClick={item.onAction}>{item.actionLabel}</Button>
        </div>
      ))}</div> : <div className="mt-5 flex items-center gap-3 rounded-md bg-emerald-500/10 p-4"><CheckCircle2 className="h-5 w-5 text-emerald-600" /><div><p className="text-sm font-medium">Operação em dia</p><p className="text-xs text-muted-foreground">Nenhuma pendência operacional identificada.</p></div></div>}
    </div>
  );
}
