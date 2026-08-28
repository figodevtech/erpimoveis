"use client";

import * as React from "react";
import {
  Activity,
  CalendarRange,
  Clock3,
  RadioTower,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { motion } from "motion/react";

import type {
  OperationalEvent,
  OperationalNode,
  OperationalPeriod,
} from "@/lib/central-operacional/contracts";
import {
  formatOperationalEventValue,
  formatOperationalIndicator,
} from "@/lib/central-operacional/formatters";
import { OPERATIONAL_PERIOD_LABELS } from "@/lib/central-operacional/period";
import { operationalPresentationFor } from "@/lib/central-operacional/presentation";
import { useOperationalReducedMotion } from "../hooks/use-operational-reduced-motion";

function operationalDateTime(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

export function OperationalNodeWindow({
  node,
  period,
  updatedAt,
  lastEvent,
  hideValues,
  paused,
  onClose,
}: {
  node: OperationalNode;
  period: OperationalPeriod;
  updatedAt: string;
  lastEvent: OperationalEvent | null;
  hideValues: boolean;
  paused: boolean;
  onClose: () => void;
}) {
  const reducedMotion = useOperationalReducedMotion();
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const presentation = operationalPresentationFor(node.modulo);
  const Icon = presentation.icon;
  const titleId = `operational-node-window-title-${node.modulo.toLowerCase()}`;
  const shouldAnimate = !paused && !reducedMotion;
  const eventValue = lastEvent
    ? formatOperationalEventValue(lastEvent.valor, lastEvent.quantidade, hideValues)
    : null;

  React.useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeRef.current?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [onClose]);

  return (
    <motion.div
      className="operational-node-window-layer"
      data-paused={paused}
      initial={shouldAnimate ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: shouldAnimate ? 0.22 : 0 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.section
        className="operational-node-window"
        data-module={node.modulo}
        data-priority={node.alerta ? "ATENCAO" : "INFO"}
        role="dialog"
        aria-labelledby={titleId}
        initial={shouldAnimate ? { opacity: 0, scale: 0.72, y: 24 } : false}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={shouldAnimate ? { opacity: 0, scale: 0.82, y: 14 } : { opacity: 0 }}
        transition={{
          duration: shouldAnimate ? 0.38 : 0,
          ease: [0.2, 0.82, 0.26, 1],
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span className="operational-node-window-aura" aria-hidden="true" />

        <header className="operational-node-window-header">
          <span className="operational-node-window-icon"><Icon aria-hidden="true" /></span>
          <div>
            <small>MÓDULO OPERACIONAL</small>
            <h2 id={titleId}>{presentation.label}</h2>
          </div>
          <span className="operational-node-window-state">
            <i aria-hidden="true" /> {node.estado}
          </span>
          <button
            ref={closeRef}
            type="button"
            className="operational-node-window-close"
            onClick={onClose}
            aria-label={`Fechar detalhes de ${presentation.label}`}
            title="Fechar janela"
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="operational-node-window-hero">
          <small>RESULTADO DO PERÍODO</small>
          <strong>{formatOperationalIndicator(node.indicador, hideValues)}</strong>
          <p>{node.detalhe ?? "Dados protegidos pelas permissões do módulo."}</p>
        </div>

        <div className="operational-node-window-grid">
          <article>
            {node.alerta ? <TriangleAlert aria-hidden="true" /> : <Activity aria-hidden="true" />}
            <small>SITUAÇÃO</small>
            <strong>{node.alerta ? "REQUER ATENÇÃO" : node.estado}</strong>
          </article>
          <article>
            <CalendarRange aria-hidden="true" />
            <small>PERÍODO</small>
            <strong>{OPERATIONAL_PERIOD_LABELS[period].button}</strong>
          </article>
          <article>
            <ShieldCheck aria-hidden="true" />
            <small>ACESSO</small>
            <strong>{node.disponivel ? "AUTORIZADO" : "RESTRITO"}</strong>
          </article>
          <article>
            <Clock3 aria-hidden="true" />
            <small>ATUALIZADO</small>
            <strong>{operationalDateTime(updatedAt)}</strong>
          </article>
        </div>

        <div className="operational-node-window-event" data-empty={!lastEvent}>
          <div>
            <RadioTower aria-hidden="true" />
            <span>
              <small>ÚLTIMO EVENTO RELACIONADO</small>
              <strong>{lastEvent?.titulo ?? "Nenhum evento recente para este módulo"}</strong>
            </span>
            {eventValue ? <b>{eventValue}</b> : null}
          </div>
          {lastEvent?.descricao ? <p>{lastEvent.descricao}</p> : null}
          {lastEvent ? <time dateTime={lastEvent.ocorridoEm}>{operationalDateTime(lastEvent.ocorridoEm)}</time> : null}
        </div>

        <footer className="operational-node-window-footer">
          <span><i aria-hidden="true" /> SNAPSHOT + REALTIME</span>
          <small>SOMENTE VISUALIZAÇÃO</small>
        </footer>
      </motion.section>
    </motion.div>
  );
}
