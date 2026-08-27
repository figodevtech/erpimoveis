"use client";

import { motion, useReducedMotion } from "motion/react";

import {
  isOperationalNodeModule,
  type OperationalEvent,
  type OperationalNodeModule,
} from "@/lib/central-operacional/contracts";
import { operationalVisualFor } from "@/lib/central-operacional/event-mapping";

export const CORE_POSITION = { x: 500, y: 310 };
export const NODE_POSITIONS: Record<OperationalNodeModule, { x: number; y: number }> = {
  VENDAS: { x: 500, y: 76 },
  CONTAS_RECEBER: { x: 810, y: 190 },
  CONTAS_PAGAR: { x: 770, y: 480 },
  ORDENS: { x: 500, y: 540 },
  FINANCEIRO: { x: 230, y: 480 },
  FISCAL: { x: 190, y: 190 },
};

export function OperationalConnections({
  activeEvent,
  paused,
}: {
  activeEvent: OperationalEvent | null;
  paused: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const visual = activeEvent ? operationalVisualFor(activeEvent.tipo) : null;
  const activeNodeModule = activeEvent && isOperationalNodeModule(activeEvent.modulo)
    ? activeEvent.modulo
    : null;
  const nodePosition = activeNodeModule ? NODE_POSITIONS[activeNodeModule] : null;
  const from = visual?.direcao === "DO_NUCLEO" ? CORE_POSITION : nodePosition;
  const to = visual?.direcao === "DO_NUCLEO" ? nodePosition : CORE_POSITION;

  return (
    <svg className="operational-connections" viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <filter id="operational-particle-glow" x="-200%" y="-200%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {Object.entries(NODE_POSITIONS).map(([rawModule, position]) => {
        const operationalModule = rawModule as OperationalNodeModule;
        const active = activeEvent?.modulo === operationalModule;
        return (
        <g
          key={operationalModule}
          data-module={operationalModule}
          data-priority={activeEvent && active ? activeEvent.prioridade : "INFO"}
          data-active={active}
          data-paused={paused}
        >
          <line x1={CORE_POSITION.x} y1={CORE_POSITION.y} x2={position.x} y2={position.y} />
          <circle className="connection-anchor" cx={position.x} cy={position.y} r="3" />
        </g>
        );
      })}
      {activeEvent && from && to && !paused && !reducedMotion ? (
        <g data-module={activeEvent.modulo} data-priority={activeEvent.prioridade} data-active="true" data-paused="false">
          <motion.circle
            className="operational-particle"
            key={`${activeEvent.id}-particle`}
            r="6"
            filter="url(#operational-particle-glow)"
            initial={{ cx: from.x, cy: from.y, opacity: 0 }}
            animate={{ cx: to.x, cy: to.y, opacity: [0, 1, 1, 0] }}
            transition={{ duration: 0.9, ease: "easeInOut" }}
          />
          <motion.circle
            className="operational-destination-ripple"
            key={`${activeEvent.id}-ripple`}
            cx={to.x}
            cy={to.y}
            initial={{ r: 4, opacity: 0 }}
            animate={{ r: [4, 4, 18], opacity: [0, 0.8, 0] }}
            transition={{ duration: 0.9, times: [0, 0.68, 1], ease: "easeOut" }}
          />
        </g>
      ) : null}
    </svg>
  );
}
