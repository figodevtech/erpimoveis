"use client";

import * as React from "react";

import type {
  OperationalEvent,
  OperationalPeriod,
  OperationalSnapshot,
} from "@/lib/central-operacional/contracts";
import { OPERATIONAL_VISUAL_EVENT_DURATION_MS } from "@/lib/central-operacional/motion-timing";
import { fetchOperationalSnapshot } from "../lib/api";
import { useOperationalRealtime } from "./use-operational-realtime";

const SNAPSHOT_INTERVAL_MS = 45_000;

export function unseenOperationalEvents(
  knownIds: ReadonlySet<string>,
  events: OperationalEvent[],
): OperationalEvent[] {
  return events
    .filter((event) => !knownIds.has(event.id))
    .sort((a, b) => new Date(a.ocorridoEm).getTime() - new Date(b.ocorridoEm).getTime());
}

export function useOperationalState() {
  const [snapshot, setSnapshot] = React.useState<OperationalSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [period, setPeriodState] = React.useState<OperationalPeriod>("DIARIO");
  const [paused, setPaused] = React.useState(false);
  const [visualQueue, setVisualQueue] = React.useState<OperationalEvent[]>([]);
  const [activeEvent, setActiveEvent] = React.useState<OperationalEvent | null>(null);
  const inFlightRef = React.useRef(false);
  const trailingRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  const firstSnapshotRef = React.useRef(true);
  const pausedRef = React.useRef(false);
  const periodRef = React.useRef<OperationalPeriod>("DIARIO");
  const knownIdsRef = React.useRef<Set<string>>(new Set());
  const abortRef = React.useRef<AbortController | null>(null);
  const loadRef = React.useRef<() => Promise<void>>(async () => undefined);

  React.useEffect(() => {
    pausedRef.current = paused;
    if (paused) {
      setVisualQueue([]);
      setActiveEvent(null);
    }
  }, [paused]);

  const load = React.useCallback(async () => {
    if (inFlightRef.current) {
      trailingRef.current = true;
      return;
    }
    inFlightRef.current = true;
    setRefreshing(true);
    const controller = new AbortController();
    const requestedPeriod = periodRef.current;
    abortRef.current = controller;
    try {
      const next = await fetchOperationalSnapshot(requestedPeriod, controller.signal);
      if (!mountedRef.current) return;
      if (requestedPeriod !== periodRef.current) {
        trailingRef.current = true;
        return;
      }

      if (firstSnapshotRef.current) {
        for (const event of next.eventosRecentes) knownIdsRef.current.add(event.id);
        firstSnapshotRef.current = false;
      } else {
        const unseen = unseenOperationalEvents(knownIdsRef.current, next.eventosRecentes);
        for (const event of unseen) knownIdsRef.current.add(event.id);
        if (!pausedRef.current && unseen.length) {
          setVisualQueue((current) => [...current, ...unseen].slice(-16));
        }
      }

      setSnapshot(next);
      setError(null);
      setLoading(false);
    } catch (requestError) {
      if (!mountedRef.current || (requestError instanceof DOMException && requestError.name === "AbortError")) return;
      setError("Não foi possível reconciliar os dados agora.");
      setLoading(false);
    } finally {
      inFlightRef.current = false;
      setRefreshing(false);
      abortRef.current = null;
      if (trailingRef.current && mountedRef.current) {
        trailingRef.current = false;
        queueMicrotask(() => void loadRef.current());
      }
    }
  }, []);
  React.useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const realtime = useOperationalRealtime({
    onInvalidate: () => void loadRef.current(),
    onReconnect: () => void loadRef.current(),
  });

  React.useEffect(() => {
    mountedRef.current = true;
    void loadRef.current();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadRef.current();
    }, SNAPSHOT_INTERVAL_MS);
    const reconcile = () => {
      if (document.visibilityState === "visible") void loadRef.current();
    };
    window.addEventListener("focus", reconcile);
    window.addEventListener("online", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("online", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
      abortRef.current?.abort();
    };
  }, []);

  const setPeriod = React.useCallback((nextPeriod: OperationalPeriod) => {
    if (periodRef.current === nextPeriod) return;
    periodRef.current = nextPeriod;
    setPeriodState(nextPeriod);
    if (inFlightRef.current) {
      trailingRef.current = true;
      abortRef.current?.abort();
    } else {
      void loadRef.current();
    }
  }, []);

  React.useEffect(() => {
    if (paused || activeEvent || visualQueue.length === 0) return;
    const [next, ...remaining] = visualQueue;
    setVisualQueue(remaining);
    setActiveEvent(next);
  }, [activeEvent, paused, visualQueue]);

  React.useEffect(() => {
    if (!activeEvent) return;
    const timer = window.setTimeout(
      () => setActiveEvent(null),
      OPERATIONAL_VISUAL_EVENT_DURATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [activeEvent]);

  return {
    snapshot,
    loading,
    refreshing,
    error,
    period,
    setPeriod,
    paused,
    setPaused,
    activeEvent,
    connectionStatus: realtime.status,
    onlineUsers: realtime.onlineUsers,
    refresh: load,
    reconnect: realtime.reconnect,
  };
}
