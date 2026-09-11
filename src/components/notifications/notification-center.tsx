"use client";

import * as React from "react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, Bell, CheckCheck, CircleDollarSign, MessageCircle, PackageCheck, ShoppingBag, Trash2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";

import { UnreadBadge } from "@/components/chat/unread-badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fetchRealtimeToken } from "@/components/chat/chat-api";
import { ensureChatRealtimeCredentials } from "@/lib/chat/realtime-token";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { cn } from "@/lib/utils";

type SystemNotification = {
  id: string;
  category: "MARKETPLACE" | "SALES" | "STOCK" | "FINANCIAL" | "SYSTEM";
  priority: "INFO" | "SUCCESS" | "WARNING" | "CRITICAL";
  title: string;
  message: string;
  href: string | null;
  source: string;
  metadata?: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

type NotificationResponse = { notifications: SystemNotification[]; unreadCount: number };
const FALLBACK_POLL_INTERVAL_MS = 2 * 60_000;
const REALTIME_RECONCILIATION_INTERVAL_MS = 15 * 60_000;
const VISIBILITY_REVALIDATION_INTERVAL_MS = 2 * 60_000;
const POLL_TICK_INTERVAL_MS = 60_000;
const MAX_RETRY_INTERVAL_MS = 5 * 60_000;

export function NotificationCenter() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [notifications, setNotifications] = React.useState<SystemNotification[]>([]);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [clearing, setClearing] = React.useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = React.useState(false);
  const [dismissingIds, setDismissingIds] = React.useState<Set<string>>(new Set());
  const knownNotificationIdsRef = React.useRef<Set<string>>(new Set());
  const failedLoadsRef = React.useRef(0);
  const retryAfterRef = React.useRef(0);
  const lastSuccessfulLoadRef = React.useRef(0);
  const realtimeConnectedRef = React.useRef(false);

  const load = React.useCallback(async (signal?: AbortSignal, force = false) => {
    if (!force && Date.now() < retryAfterRef.current) return;
    try {
      const response = await fetch("/api/notifications?limit=50", { cache: "no-store", signal });
      if (!response.ok) throw new Error(`Notificações indisponíveis (${response.status}).`);
      const data = await response.json() as NotificationResponse;
      const nextNotifications = Array.isArray(data.notifications) ? data.notifications : [];
      knownNotificationIdsRef.current = new Set(nextNotifications.map((notification) => notification.id));
      setNotifications(nextNotifications);
      setUnreadCount(Math.max(Number(data.unreadCount ?? 0), 0));
      failedLoadsRef.current = 0;
      retryAfterRef.current = 0;
      lastSuccessfulLoadRef.current = Date.now();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        failedLoadsRef.current += 1;
        const retryIn = Math.min(
          FALLBACK_POLL_INTERVAL_MS * (2 ** Math.max(failedLoadsRef.current - 1, 0)),
          MAX_RETRY_INTERVAL_MS,
        );
        retryAfterRef.current = Date.now() + retryIn;
        console.warn("Falha ao atualizar notificações do sistema.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const interval = realtimeConnectedRef.current
        ? REALTIME_RECONCILIATION_INTERVAL_MS
        : FALLBACK_POLL_INTERVAL_MS;
      if (Date.now() - lastSuccessfulLoadRef.current >= interval) void load();
    }, POLL_TICK_INTERVAL_MS);
    const onVisible = () => {
      if (
        document.visibilityState === "visible"
        && Date.now() - lastSuccessfulLoadRef.current >= VISIBILITY_REVALIDATION_INTERVAL_MS
      ) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  React.useEffect(() => {
    let disposed = false;
    let channel: ReturnType<typeof supabaseBrowser.channel> | null = null;

    const connect = async () => {
      try {
        const credentials = await ensureChatRealtimeCredentials(fetchRealtimeToken);
        if (disposed) return;
        await supabaseBrowser.realtime.setAuth(credentials.token);
        if (disposed) return;

        channel = supabaseBrowser
          .channel(`system-notifications:${crypto.randomUUID()}`)
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "system_notification" },
            (payload) => {
              const row = payload.new as Record<string, unknown>;
              const incoming = realtimeNotification(row);
              if (incoming && !knownNotificationIdsRef.current.has(incoming.id)) {
                knownNotificationIdsRef.current.add(incoming.id);
                setNotifications((current) => [incoming, ...current].slice(0, 50));
                if (!incoming.readAt) setUnreadCount((current) => current + 1);
              }
              window.dispatchEvent(new CustomEvent("erp:system-notification", { detail: row }));
            },
          )
          .subscribe((status) => {
            realtimeConnectedRef.current = status === "SUBSCRIBED";
          });
      } catch {
        realtimeConnectedRef.current = false;
        // A consulta periodica acima permanece ativa se o Realtime estiver
        // indisponivel ou ainda nao tiver sido habilitado no banco deste ERP.
      }
    };

    void connect();
    return () => {
      disposed = true;
      realtimeConnectedRef.current = false;
      if (channel) void supabaseBrowser.removeChannel(channel);
    };
  }, [load]);

  React.useEffect(() => {
    if (open) void load(undefined, true);
  }, [load, open]);

  const markRead = React.useCallback(async (notification: SystemNotification) => {
    if (notification.readAt) return;
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, readAt } : item));
    setUnreadCount((current) => Math.max(current - 1, 0));
    const response = await fetch(`/api/notifications/${notification.id}/read`, { method: "POST" });
    if (!response.ok) void load();
  }, [load]);

  const openNotification = React.useCallback((notification: SystemNotification) => {
    void markRead(notification);
    if (notification.href) {
      setOpen(false);
      router.push(notification.href);
    }
  }, [markRead, router]);

  const markAllRead = React.useCallback(async () => {
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((item) => item.readAt ? item : { ...item, readAt }));
    setUnreadCount(0);
    const response = await fetch("/api/notifications/read-all", { method: "POST" });
    if (!response.ok) void load();
  }, [load]);

  const clearNotifications = React.useCallback(async () => {
    setClearing(true);
    const previous = notifications;
    const previousUnreadCount = unreadCount;
    const visibleIds = notifications.map((notification) => notification.id);
    setNotifications([]);
    setUnreadCount(0);
    try {
      const response = await fetch("/api/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: visibleIds }),
      });
      if (!response.ok) {
        setNotifications(previous);
        setUnreadCount(previousUnreadCount);
        void load();
      }
    } finally {
      setClearing(false);
    }
  }, [load, notifications, unreadCount]);

  const dismissNotification = React.useCallback(async (notification: SystemNotification) => {
    if (dismissingIds.has(notification.id)) return;
    setDismissingIds((current) => new Set(current).add(notification.id));
    setNotifications((current) => current.filter((item) => item.id !== notification.id));
    if (!notification.readAt) setUnreadCount((current) => Math.max(current - 1, 0));
    try {
      const response = await fetch(`/api/notifications/${notification.id}`, { method: "DELETE" });
      if (!response.ok) void load();
    } finally {
      setDismissingIds((current) => {
        const next = new Set(current);
        next.delete(notification.id);
        return next;
      });
    }
  }, [dismissingIds, load]);

  return (
    <>
      <Popover open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) setConfirmClearOpen(false); }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="group relative size-10 shrink-0 rounded-xl transition-[background-color,color,transform,box-shadow] duration-200 hover:bg-primary/10 hover:text-primary hover:shadow-sm active:scale-[0.94] motion-reduce:transform-none sm:size-9"
            aria-label="Abrir notificações"
          >
            <Bell aria-hidden="true" className="transition-transform duration-200 group-hover:-translate-y-0.5 motion-reduce:transform-none" />
            <UnreadBadge count={unreadCount} compact singular="notificação não lida" plural="notificações não lidas" />
          </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>Notificações</TooltipContent>
      </Tooltip>

        <PopoverContent align="end" sideOffset={8} collisionPadding={8} className="w-[calc(100vw-1rem)] overflow-hidden rounded-2xl p-0 shadow-xl sm:w-[430px]">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
            <div>
                <h2 className="text-base font-semibold leading-none">Notificações</h2>
                <p className="mt-1.5 text-xs text-muted-foreground">Atualizações do ERP e dos canais integrados.</p>
            </div>
            {notifications.length > 0 ? (
              <div className="flex flex-wrap items-center justify-end gap-1">
              {confirmClearOpen ? (
                <>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmClearOpen(false)}>
                  Cancelar
                </Button>
                <Button type="button" variant="destructive" size="sm" disabled={clearing} onClick={() => { setConfirmClearOpen(false); void clearNotifications(); }}>
                  Confirmar
                </Button>
                </>
              ) : (
                <>
                {unreadCount > 0 ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => void markAllRead()}>
                    <CheckCheck className="h-4 w-4" />
                    Ler todas
                  </Button>
                ) : null}
                  <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" disabled={clearing} onClick={() => setConfirmClearOpen(true)}>
                    <Trash2 className="h-4 w-4" />
                    Limpar
                  </Button>
                </>
              )}
              </div>
            ) : null}
          </div>

          <ScrollArea className="h-[min(65vh,560px)]">
            <div className="space-y-3 p-4">
              <AnimatePresence initial={false} mode="popLayout">
              {notifications.map((notification) => (
                <motion.div
                  key={notification.id}
                  layout={!reduceMotion}
                  initial={reduceMotion ? false : { opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 34, scale: 0.96 }}
                  transition={{ duration: reduceMotion ? 0.1 : 0.2, ease: "easeOut" }}
                >
                <NotificationItem
                  notification={notification}
                  dismissing={dismissingIds.has(notification.id)}
                  onClick={() => openNotification(notification)}
                  onDismiss={() => void dismissNotification(notification)}
                />
                </motion.div>
              ))}
              {!loading && notifications.length === 0 ? (
                <motion.div
                  key="empty-notifications"
                  initial={reduceMotion ? false : { opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex min-h-64 flex-col items-center justify-center px-8 text-center"
                >
                  <span className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><Bell className="size-5" /></span>
                  <p className="text-sm font-medium">Nenhuma notificação</p>
                  <p className="mt-1 text-xs text-muted-foreground">As atualizações importantes aparecerão aqui.</p>
                </motion.div>
              ) : null}
              </AnimatePresence>
              {loading && notifications.length === 0 ? (
                <div className="space-y-3 p-5" aria-label="Carregando notificações">
                  {[1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-xl bg-muted" />)}
                </div>
              ) : null}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>

    </>
  );
}

function NotificationItem({ notification, dismissing, onClick, onDismiss }: {
  notification: SystemNotification;
  dismissing: boolean;
  onClick: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative min-h-[116px] w-full rounded-xl border bg-card text-left shadow-sm transition-[border-color,background-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-primary/25 hover:bg-muted/30 hover:shadow-md motion-reduce:hover:translate-y-0",
        !notification.readAt && "border-primary/25 bg-primary/[0.045] shadow-primary/5",
      )}
    >
      <button type="button" className="flex min-h-[116px] w-full gap-3 rounded-xl p-4 pr-12 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={onClick}>
      <span className={cn("relative flex size-10 shrink-0 items-center justify-center rounded-xl", iconClass(notification))}>
        <NotificationIcon notification={notification} />
        {!notification.readAt ? (
          <span
            className="absolute -right-1 -top-1 size-3 rounded-full border-2 border-card bg-primary shadow-sm"
            aria-label="Não lida"
          />
        ) : null}
      </span>
      <span className="flex min-h-[82px] min-w-0 flex-1 flex-col">
        <span className="flex items-start justify-between gap-3">
          <span className={cn("text-sm leading-snug", notification.readAt ? "font-medium" : "font-semibold")}>{notification.title}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{safeRelativeDate(notification.createdAt)}</span>
        </span>
        <span className="mt-1 whitespace-pre-line break-words text-xs leading-relaxed text-muted-foreground">{notification.message}</span>
        <span className="mt-auto block pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
          {notification.source === "MERCADOLIVRE_WEBHOOK" ? "Mercado Livre" : "Sistema"}
        </span>
      </span>
      </button>
      <button
        type="button"
        disabled={dismissing}
        aria-label={`Limpar notificação: ${notification.title}`}
        className="absolute bottom-2.5 right-2.5 flex size-8 items-center justify-center rounded-md text-muted-foreground opacity-70 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100"
        onClick={(event) => {
          event.stopPropagation();
          onDismiss();
        }}
        title="Limpar esta notificação"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

function NotificationIcon({ notification }: { notification: SystemNotification }) {
  const className = "size-4";
  if (notification.priority === "CRITICAL" || notification.priority === "WARNING") return <AlertTriangle className={className} aria-hidden="true" />;
  if (notification.category === "MARKETPLACE") return <ShoppingBag className={className} aria-hidden="true" />;
  if (notification.category === "STOCK") return <PackageCheck className={className} aria-hidden="true" />;
  if (notification.category === "FINANCIAL") return <CircleDollarSign className={className} aria-hidden="true" />;
  if (notification.category === "SALES") return <MessageCircle className={className} aria-hidden="true" />;
  return <Bell className={className} aria-hidden="true" />;
}

function iconClass(notification: SystemNotification) {
  if (notification.priority === "CRITICAL") return "bg-destructive/10 text-destructive";
  if (notification.priority === "WARNING") return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  if (notification.priority === "SUCCESS") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  return "bg-primary/10 text-primary";
}

function safeRelativeDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatDistanceToNow(date, { addSuffix: true, locale: ptBR });
}

function realtimeNotification(row: Record<string, unknown>): SystemNotification | null {
  const id = String(row.id ?? "");
  const title = String(row.title ?? "").trim();
  const message = String(row.message ?? "").trim();
  if (!id || !title || !message) return null;
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {};
  if (metadata.dismissed === true) return null;
  return {
    id,
    category: (row.category ?? "SYSTEM") as SystemNotification["category"],
    priority: (row.priority ?? "INFO") as SystemNotification["priority"],
    title,
    message,
    href: row.href ? String(row.href) : null,
    source: String(row.source ?? "SYSTEM"),
    metadata,
    readAt: row.read_at ? String(row.read_at) : null,
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}
