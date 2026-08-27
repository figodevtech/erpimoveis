"use client";

import * as React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

import { EventFeed } from "./components/event-feed";
import { OperationalHeader } from "./components/operational-header";
import { OperationalMap } from "./components/operational-map";
import { OperationalTicker } from "./components/operational-ticker";
import { useOperationalState } from "./hooks/use-operational-state";
import { OPERATIONAL_PERIOD_LABELS } from "@/lib/central-operacional/period";

const HIDE_VALUES_KEY = "central-operacional:hide-values";

export function CentralOperacional() {
  const rootRef = React.useRef<HTMLElement>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const [hideValues, setHideValues] = React.useState(true);
  const [fullscreen, setFullscreen] = React.useState(false);
  const state = useOperationalState();

  React.useEffect(() => {
    setHideValues(window.localStorage.getItem(HIDE_VALUES_KEY) !== "false");
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("fullscreenchange", syncFullscreen);
    };
  }, []);

  const toggleValues = () => {
    setHideValues((current) => {
      const next = !current;
      window.localStorage.setItem(HIDE_VALUES_KEY, String(next));
      return next;
    });
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch {
      // O navegador pode recusar a API em contextos incorporados; a tela continua funcional.
    }
  };

  if (state.loading && !state.snapshot) {
    return (
      <main ref={rootRef} className="operational-screen operational-loading" aria-busy="true">
        <div className="operational-loader" aria-hidden="true"><i /><i /><i /></div>
        <strong>Preparando a Central Operacional</strong>
        <span>Consolidando os módulos autorizados…</span>
      </main>
    );
  }

  if (!state.snapshot) {
    return (
      <main ref={rootRef} className="operational-screen operational-loading" role="alert">
        <AlertTriangle aria-hidden="true" />
        <strong>Não foi possível abrir a Central Operacional</strong>
        <span>{state.error ?? "A fonte de dados está temporariamente indisponível."}</span>
        <button type="button" onClick={() => void state.refresh()}><RotateCcw /> Tentar novamente</button>
      </main>
    );
  }

  return (
    <main ref={rootRef} className="operational-screen">
      <OperationalHeader
        snapshot={state.snapshot}
        connectionStatus={state.connectionStatus}
        onlineUsers={state.onlineUsers}
        now={now}
        hideValues={hideValues}
        paused={state.paused}
        refreshing={state.refreshing}
        period={state.period}
        fullscreen={fullscreen}
        onToggleValues={toggleValues}
        onTogglePaused={() => state.setPaused((current) => !current)}
        onToggleFullscreen={() => void toggleFullscreen()}
        onRefresh={() => void state.refresh()}
        onPeriodChange={state.setPeriod}
      />

      <div className="operational-workspace">
        <OperationalMap
          snapshot={state.snapshot}
          activeEvent={state.activeEvent}
          paused={state.paused}
          hideValues={hideValues}
        />
        <EventFeed
          events={state.snapshot.eventosRecentes}
          eventCount={state.snapshot.eventosPeriodo}
          counterLabel={OPERATIONAL_PERIOD_LABELS[state.snapshot.meta.periodo].counter}
          now={now}
          hideValues={hideValues}
          paused={state.paused}
        />
      </div>

      {state.error ? (
        <button className="operational-reconciliation-warning" type="button" onClick={() => void state.refresh()}>
          <AlertTriangle aria-hidden="true" /> {state.error} Mantendo o último snapshot. Tentar novamente.
        </button>
      ) : null}

      <OperationalTicker
        attentions={state.snapshot.atencoes}
        hideValues={hideValues}
        paused={state.paused}
      />
    </main>
  );
}
