"use client";

import { motion } from "motion/react";

import {
  isOperationalNodeModule,
  type OperationalEvent,
  type OperationalNodeModule,
} from "@/lib/central-operacional/contracts";
import {
  OPERATIONAL_FLOW_TRAVEL_MS,
  OPERATIONAL_NODE_FEED_DURATION_MS,
  OPERATIONAL_NODE_IMPACT_DELAY_MS,
} from "@/lib/central-operacional/motion-timing";
import { useOperationalReducedMotion } from "../hooks/use-operational-reduced-motion";

export const CORE_POSITION = { x: 500, y: 310 };
export const NODE_POSITIONS: Record<OperationalNodeModule, { x: number; y: number }> = {
  VENDAS: { x: 500, y: 76 },
  CONTAS_RECEBER: { x: 810, y: 190 },
  CONTAS_PAGAR: { x: 770, y: 480 },
  ORDENS: { x: 500, y: 540 },
  FINANCEIRO: { x: 230, y: 480 },
  FISCAL: { x: 190, y: 190 },
};

export function operationalConnectionPath(module: OperationalNodeModule) {
  return {
    from: CORE_POSITION,
    to: NODE_POSITIONS[module],
  };
}

export function OperationalConnections({
  activeEvent,
  paused,
  onParticleArrive,
}: {
  activeEvent: OperationalEvent | null;
  paused: boolean;
  onParticleArrive?: (eventId: string) => void;
}) {
  const reducedMotion = useOperationalReducedMotion();
  const activeNodeModule = activeEvent && isOperationalNodeModule(activeEvent.modulo)
    ? activeEvent.modulo
    : null;
  const activePath = activeNodeModule ? operationalConnectionPath(activeNodeModule) : null;

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
      {activeEvent && activePath && !paused && !reducedMotion ? (
        <g data-module={activeEvent.modulo} data-priority={activeEvent.prioridade} data-active="true" data-paused="false">
          <motion.circle
            className="operational-origin-pulse"
            key={`${activeEvent.id}-origin`}
            cx={activePath.from.x}
            cy={activePath.from.y}
            initial={{ r: 7, opacity: 0 }}
            animate={{ r: [7, 23, 10], opacity: [0, 0.72, 0] }}
            transition={{ duration: 0.48, times: [0, 0.46, 1], ease: "easeOut" }}
          />
          <motion.circle
            className="operational-particle-halo"
            key={`${activeEvent.id}-halo`}
            r="13"
            initial={{ cx: activePath.from.x, cy: activePath.from.y, opacity: 0 }}
            animate={{
              cx: activePath.to.x,
              cy: activePath.to.y,
              opacity: [0, 0.28, 0.2, 0],
            }}
            transition={{
              duration: OPERATIONAL_FLOW_TRAVEL_MS / 1_000,
              times: [0, 0.12, 0.82, 1],
              ease: [0.22, 0.72, 0.28, 1],
            }}
          />
          <motion.circle
            className="operational-particle"
            key={`${activeEvent.id}-particle`}
            filter="url(#operational-particle-glow)"
            initial={{ cx: activePath.from.x, cy: activePath.from.y, r: 4, opacity: 0 }}
            animate={{
              cx: activePath.to.x,
              cy: activePath.to.y,
              r: [4, 7, 6, 4],
              opacity: [0, 1, 1, 0.72],
            }}
            transition={{
              duration: OPERATIONAL_FLOW_TRAVEL_MS / 1_000,
              times: [0, 0.14, 0.82, 1],
              ease: [0.22, 0.72, 0.28, 1],
            }}
            onAnimationComplete={() => onParticleArrive?.(activeEvent.id)}
          />
          <motion.circle
            className="operational-destination-ripple"
            key={`${activeEvent.id}-ripple`}
            cx={activePath.to.x}
            cy={activePath.to.y}
            initial={{ r: 4, opacity: 0 }}
            animate={{ r: [4, 11, 25], opacity: [0, 0.86, 0] }}
            transition={{
              delay: OPERATIONAL_NODE_IMPACT_DELAY_MS / 1_000,
              duration: OPERATIONAL_NODE_FEED_DURATION_MS / 1_000,
              times: [0, 0.22, 1],
              ease: "easeOut",
            }}
          />
        </g>
      ) : null}
    </svg>
  );
}
