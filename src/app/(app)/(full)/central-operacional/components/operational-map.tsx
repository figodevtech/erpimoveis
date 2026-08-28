"use client";

import * as React from "react";
import { AnimatePresence } from "motion/react";

import type {
  OperationalEvent,
  OperationalNodeModule,
  OperationalSnapshot,
} from "@/lib/central-operacional/contracts";
import {
  isOperationalNodeModule,
  OPERATIONAL_NODE_MODULES,
} from "@/lib/central-operacional/contracts";
import { operationalVisualFor } from "@/lib/central-operacional/event-mapping";
import { useOperationalReducedMotion } from "../hooks/use-operational-reduced-motion";
import { OperationalAlert } from "./operational-alert";
import { OperationalConnections, NODE_POSITIONS } from "./operational-connections";
import { OperationalCore } from "./operational-core";
import { OperationalNode } from "./operational-node";
import { OperationalNodeWindow } from "./operational-node-window";

export function OperationalMap({
  snapshot,
  activeEvent,
  paused,
  hideValues,
  selectedModule,
  onNodeSelect,
  onNodeClose,
}: {
  snapshot: OperationalSnapshot;
  activeEvent: OperationalEvent | null;
  paused: boolean;
  hideValues: boolean;
  selectedModule: OperationalNodeModule | null;
  onNodeSelect: (module: OperationalNodeModule) => void;
  onNodeClose: () => void;
}) {
  const reducedMotion = useOperationalReducedMotion();
  const [feedingEventId, setFeedingEventId] = React.useState<string | null>(null);
  const criticalAttention = snapshot.atencoes.find((attention) => attention.prioridade === "CRITICO")
    ?? snapshot.atencoes[0]
    ?? null;
  const activeVisual = activeEvent ? operationalVisualFor(activeEvent.tipo) : null;
  const activeNodeModule = activeEvent && isOperationalNodeModule(activeEvent.modulo)
    ? activeEvent.modulo
    : null;
  const selectedNode = selectedModule ? snapshot.modulos[selectedModule] : null;
  const selectedLastEvent = selectedModule
    ? snapshot.eventosRecentes.find((event) => event.modulo === selectedModule) ?? null
    : null;
  const handleParticleArrive = React.useCallback((eventId: string) => {
    if (!paused && activeEvent?.id === eventId) setFeedingEventId(eventId);
  }, [activeEvent?.id, paused]);

  return (
    <section className="operational-map-panel" aria-label="Mapa operacional">
      <div className="operational-map-label">
        <span>MAPA OPERACIONAL</span>
        <small>{paused ? "ANIMAÇÕES PAUSADAS" : "ATIVIDADE REAL"}</small>
      </div>
      {criticalAttention ? <OperationalAlert attention={criticalAttention} hideValues={hideValues} paused={paused} /> : null}
      <div className="operational-map-scroll">
        <div className="operational-map-canvas">
          <OperationalConnections
            activeEvent={activeEvent}
            paused={paused}
            onParticleArrive={handleParticleArrive}
          />
          <OperationalCore
            activeModule={activeEvent?.modulo ?? null}
            activePriority={activeEvent?.prioridade ?? "INFO"}
            paused={paused}
          />
          {OPERATIONAL_NODE_MODULES.map((module) => (
            <OperationalNode
              key={module}
              node={snapshot.modulos[module]}
              position={NODE_POSITIONS[module]}
              active={
                activeNodeModule === module
                && (Boolean(reducedMotion) || feedingEventId === activeEvent?.id)
              }
              priority={
                activeEvent?.modulo === module && activeEvent.prioridade !== "INFO"
                  ? activeEvent.prioridade
                  : snapshot.modulos[module].alerta
                    ? "ATENCAO"
                    : "INFO"
              }
              paused={paused}
              transientState={
                activeNodeModule === module
                  && (Boolean(reducedMotion) || feedingEventId === activeEvent?.id)
                  ? activeVisual?.estado ?? null
                  : null
              }
              hideValues={hideValues}
              selected={selectedModule === module}
              onSelect={onNodeSelect}
            />
          ))}
        </div>
      </div>

      <AnimatePresence>
        {selectedNode ? (
          <OperationalNodeWindow
            key={selectedNode.modulo}
            node={selectedNode}
            period={snapshot.meta.periodo}
            updatedAt={snapshot.meta.atualizadoEm}
            lastEvent={selectedLastEvent}
            hideValues={hideValues}
            paused={paused}
            onClose={onNodeClose}
          />
        ) : null}
      </AnimatePresence>
    </section>
  );
}
