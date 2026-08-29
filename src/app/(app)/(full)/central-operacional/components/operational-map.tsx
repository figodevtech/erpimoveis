"use client";

import type { OperationalEvent, OperationalSnapshot } from "@/lib/central-operacional/contracts";
import { OPERATIONAL_NODE_MODULES } from "@/lib/central-operacional/contracts";
import { operationalVisualFor } from "@/lib/central-operacional/event-mapping";
import { OperationalAlert } from "./operational-alert";
import { OperationalConnections, NODE_POSITIONS } from "./operational-connections";
import { OperationalCore } from "./operational-core";
import { OperationalNode } from "./operational-node";

export function OperationalMap({
  snapshot,
  activeEvent,
  paused,
  hideValues,
}: {
  snapshot: OperationalSnapshot;
  activeEvent: OperationalEvent | null;
  paused: boolean;
  hideValues: boolean;
}) {
  const criticalAttention = snapshot.atencoes.find((attention) => attention.prioridade === "CRITICO")
    ?? snapshot.atencoes[0]
    ?? null;
  const activeVisual = activeEvent ? operationalVisualFor(activeEvent.tipo) : null;

  return (
    <section className="operational-map-panel" aria-label="Mapa operacional">
      <div className="operational-map-label">
        <span>MAPA OPERACIONAL</span>
        <small>{paused ? "ANIMAÇÕES PAUSADAS" : "ATIVIDADE REAL"}</small>
      </div>
      {criticalAttention ? <OperationalAlert attention={criticalAttention} hideValues={hideValues} paused={paused} /> : null}
      <div className="operational-map-canvas">
        <OperationalConnections activeEvent={activeEvent} paused={paused} />
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
            active={activeEvent?.modulo === module}
            priority={
              activeEvent?.modulo === module && activeEvent.prioridade !== "INFO"
                ? activeEvent.prioridade
                : snapshot.modulos[module].alerta
                  ? "ATENCAO"
                  : "INFO"
            }
            paused={paused}
            transientState={activeEvent?.modulo === module ? activeVisual?.estado ?? null : null}
            hideValues={hideValues}
          />
        ))}
      </div>
    </section>
  );
}
