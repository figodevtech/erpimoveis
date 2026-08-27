"use client";

import { motion, useReducedMotion } from "motion/react";

import type {
  OperationalNode as OperationalNodeData,
  OperationalPriority,
} from "@/lib/central-operacional/contracts";
import { formatOperationalIndicator } from "@/lib/central-operacional/formatters";
import { operationalPresentationFor } from "@/lib/central-operacional/presentation";

export function OperationalNode({
  node,
  active,
  priority,
  paused,
  transientState,
  hideValues,
  position,
}: {
  node: OperationalNodeData;
  active: boolean;
  priority: OperationalPriority;
  paused: boolean;
  transientState: string | null;
  hideValues: boolean;
  position: { x: number; y: number };
}) {
  const reducedMotion = useReducedMotion();
  const presentation = operationalPresentationFor(node.modulo);
  const Icon = presentation.icon;
  const state = transientState ?? node.estado;

  return (
    <motion.article
      className={`operational-node ${node.alerta ? "has-alert" : ""} ${!node.disponivel ? "is-restricted" : ""}`}
      style={{ left: `${position.x / 10}%`, top: `${position.y / 6.2}%` }}
      data-module={node.modulo}
      data-priority={priority}
      data-active={active}
      data-paused={paused}
      animate={reducedMotion || paused || !active ? { scale: 1 } : { scale: [1, 1.035, 1] }}
      transition={{ duration: 0.72, ease: "easeOut" }}
      aria-label={`${presentation.label}: ${state}`}
    >
      <div className="operational-node-heading">
        <span className="operational-node-icon"><Icon aria-hidden="true" /></span>
        <span>{presentation.label}</span>
      </div>
      <div className="operational-node-state"><i aria-hidden="true" />{state}</div>
      <strong className="operational-node-value">{formatOperationalIndicator(node.indicador, hideValues)}</strong>
      <small>{node.detalhe ?? "Dados protegidos"}</small>
    </motion.article>
  );
}
