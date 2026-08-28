"use client";

import type { KeyboardEvent } from "react";
import { motion } from "motion/react";

import type {
  OperationalNode as OperationalNodeData,
  OperationalNodeModule,
  OperationalPriority,
} from "@/lib/central-operacional/contracts";
import { formatOperationalIndicator } from "@/lib/central-operacional/formatters";
import { OPERATIONAL_NODE_FEED_DURATION_MS } from "@/lib/central-operacional/motion-timing";
import { operationalPresentationFor } from "@/lib/central-operacional/presentation";
import {
  OPERATIONAL_FLOAT_REST,
  useOperationalFloat,
} from "../hooks/use-operational-float";
import { useOperationalReducedMotion } from "../hooks/use-operational-reduced-motion";
import { CORE_POSITION } from "./operational-connections";

export { OPERATIONAL_NODE_FLOAT_PROFILES } from "../hooks/use-operational-float";

export function OperationalNode({
  node,
  active,
  priority,
  paused,
  transientState,
  hideValues,
  position,
  selected,
  onSelect,
}: {
  node: OperationalNodeData;
  active: boolean;
  priority: OperationalPriority;
  paused: boolean;
  transientState: string | null;
  hideValues: boolean;
  position: { x: number; y: number };
  selected: boolean;
  onSelect: (module: OperationalNodeModule) => void;
}) {
  const reducedMotion = useOperationalReducedMotion();
  const presentation = operationalPresentationFor(node.modulo);
  const Icon = presentation.icon;
  const state = transientState ?? node.estado;
  const distanceX = position.x - CORE_POSITION.x;
  const distanceY = position.y - CORE_POSITION.y;
  const distance = Math.hypot(distanceX, distanceY) || 1;
  const impactX = (distanceX / distance) * 5;
  const impactY = (distanceY / distance) * 5;
  const floating = !reducedMotion && !paused && !active && !selected;
  const { translate, glowOpacity, glowScale } = useOperationalFloat(node.modulo, floating);
  const feedingMotion = {
    scale: [1, 1.045, 0.995, 1.016, 1],
    x: [0, impactX, -impactX * 0.2, 0, 0],
    y: [0, impactY, -impactY * 0.2, 0, 0],
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect(node.modulo);
  };

  return (
    <motion.article
      className={`operational-node ${node.alerta ? "has-alert" : ""} ${!node.disponivel ? "is-restricted" : ""}`}
      style={{ left: `${position.x / 10}%`, top: `${position.y / 6.2}%`, translate }}
      data-module={node.modulo}
      data-priority={priority}
      data-active={active}
      data-feeding={active}
      data-floating={floating}
      data-selected={selected}
      data-paused={paused}
      animate={active && !reducedMotion && !paused
        ? feedingMotion
        : { scale: 1, x: 0, y: 0 }}
      transition={active && !reducedMotion && !paused
        ? {
            duration: OPERATIONAL_NODE_FEED_DURATION_MS / 1_000,
            times: [0, 0.2, 0.46, 0.72, 1],
            ease: "easeOut",
          }
        : OPERATIONAL_FLOAT_REST}
      whileHover={!reducedMotion && !active && !selected ? { scale: 1.025 } : undefined}
      whileTap={!reducedMotion && !active && !selected ? { scale: 0.985 } : undefined}
      onClick={() => onSelect(node.modulo)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      aria-expanded={selected}
      aria-label={`Abrir detalhes de ${presentation.label}: ${state}`}
      title={`Abrir detalhes de ${presentation.label}`}
    >
      <span className="operational-node-feed" aria-hidden="true" />
      <motion.span
        className="operational-node-ambient"
        aria-hidden="true"
        style={floating ? { opacity: glowOpacity, scale: glowScale } : undefined}
        animate={floating ? undefined : { opacity: 0, scale: 0.98 }}
        transition={OPERATIONAL_FLOAT_REST}
      />
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
