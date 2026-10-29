"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  CalendarRange,
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCcw,
  X,
} from "lucide-react";

import type {
  OperationalConnectionStatus,
  OperationalPeriod,
  OperationalSnapshot,
} from "@/lib/central-operacional/contracts";
import {
  OPERATIONAL_PERIOD_LABELS,
  nextOperationalPeriod,
} from "@/lib/central-operacional/period";

const STATUS_LABELS: Record<OperationalConnectionStatus, string> = {
  CONNECTING: "CONECTANDO",
  LIVE: "AO VIVO",
  RECONNECTING: "RECONECTANDO",
  OFFLINE: "OFFLINE",
};

function Metric({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="operational-header-metric" data-accent={accent}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  children,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="operational-control"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function OperationalHeader({
  snapshot,
  connectionStatus,
  onlineUsers,
  now,
  hideValues,
  paused,
  refreshing,
  period,
  fullscreen,
  onToggleValues,
  onTogglePaused,
  onToggleFullscreen,
  onRefresh,
  onPeriodChange,
}: {
  snapshot: OperationalSnapshot;
  connectionStatus: OperationalConnectionStatus;
  onlineUsers: number | null;
  now: number;
  hideValues: boolean;
  paused: boolean;
  refreshing: boolean;
  period: OperationalPeriod;
  fullscreen: boolean;
  onToggleValues: () => void;
  onTogglePaused: () => void;
  onToggleFullscreen: () => void;
  onRefresh: () => void;
  onPeriodChange: (period: OperationalPeriod) => void;
}) {
  const time = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo",
  }).format(now);

  return (
    <header className="operational-header">
      <div className="operational-title-block">
        <span className="operational-eyebrow">ERP IMÓVEIS · {snapshot.meta.empresa}</span>
        <h1>CENTRAL OPERACIONAL</h1>
        <p>Fluxo em tempo real</p>
      </div>

      <div className="operational-header-metrics" aria-label="Indicadores gerais">
        <Metric accent="presence" label="USUÁRIOS ONLINE" value={onlineUsers === null ? "—" : String(onlineUsers).padStart(2, "0")} />
        <Metric
          accent="activity"
          label={OPERATIONAL_PERIOD_LABELS[snapshot.meta.periodo].metric}
          value={String(snapshot.geral.operacoesPeriodo).padStart(2, "0")}
        />
        <Metric accent="orders" label="OS ATIVAS" value={snapshot.geral.osAtivas === null ? "—" : String(snapshot.geral.osAtivas).padStart(2, "0")} />
        <Metric accent="sync" label="PRECISÃO" value={snapshot.meta.status} />
      </div>

      <div className="operational-live-block">
        <time dateTime={new Date(now).toISOString()}>{time}</time>
        <span className={`operational-live-status status-${connectionStatus.toLowerCase()}`}>
          <i aria-hidden="true" /> {STATUS_LABELS[connectionStatus]}
        </span>
      </div>

      <div className="operational-controls" aria-label="Controles da Central">
        <ControlButton label="Atualizar snapshot" onClick={onRefresh} disabled={refreshing}>
          <RefreshCcw className={refreshing ? "animate-spin" : ""} />
        </ControlButton>
        <ControlButton label={hideValues ? "Mostrar valores" : "Ocultar valores"} onClick={onToggleValues}>
          {hideValues ? <EyeOff /> : <Eye />}
        </ControlButton>
        <ControlButton label={paused ? "Retomar animações" : "Pausar animações"} onClick={onTogglePaused}>
          {paused ? <Play /> : <Pause />}
        </ControlButton>
        <ControlButton label={fullscreen ? "Sair da tela cheia" : "Entrar em tela cheia"} onClick={onToggleFullscreen}>
          {fullscreen ? <Minimize2 /> : <Maximize2 />}
        </ControlButton>
        <button
          type="button"
          className="operational-control operational-period-control"
          aria-label={`Período ${OPERATIONAL_PERIOD_LABELS[period].button}. Alternar para ${OPERATIONAL_PERIOD_LABELS[nextOperationalPeriod(period)].button}.`}
          title="Alternar período dos resultados"
          onClick={() => onPeriodChange(nextOperationalPeriod(period))}
        >
          <CalendarRange aria-hidden="true" />
          <span>{OPERATIONAL_PERIOD_LABELS[period].button}</span>
          {refreshing ? <i aria-hidden="true" /> : null}
        </button>
        <Link className="operational-control" href="/" aria-label="Sair da Central" title="Sair da Central">
          <X />
        </Link>
      </div>
    </header>
  );
}
