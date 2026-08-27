"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import type { OperationalEvent } from "@/lib/central-operacional/contracts";
import {
  formatOperationalEventValue,
  relativeOperationalTime,
} from "@/lib/central-operacional/formatters";
import { operationalPresentationFor } from "@/lib/central-operacional/presentation";

export function EventFeed({
  events,
  eventCount,
  counterLabel,
  now,
  hideValues,
  paused,
}: {
  events: OperationalEvent[];
  eventCount: number;
  counterLabel: string;
  now: number;
  hideValues: boolean;
  paused: boolean;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <aside className="operational-feed" aria-label="Eventos operacionais recentes">
      <div className="operational-panel-heading">
        <div>
          <span>FLUXO DE EVENTOS</span>
          <small>ÚLTIMAS MOVIMENTAÇÕES</small>
        </div>
        <span className="operational-feed-count" aria-label={`${eventCount} eventos no período`}>
          <b>{String(eventCount).padStart(2, "0")}</b>
          <small>{counterLabel}</small>
          <i aria-hidden="true" />
        </span>
      </div>

      <div className="operational-feed-list" role="log" aria-live="polite" aria-relevant="additions">
        <AnimatePresence initial={false} mode="popLayout">
          {events.slice(0, 12).map((event) => {
            const presentation = operationalPresentationFor(event.modulo);
            const Icon = presentation.icon;
            const formattedValue = formatOperationalEventValue(event.valor, event.quantidade, hideValues);
            return (
              <motion.article
                layout={!reducedMotion && !paused}
                key={event.id}
                className={`operational-feed-item priority-${event.prioridade.toLowerCase()}`}
                data-module={event.modulo}
                data-priority={event.prioridade}
                data-active="false"
                data-paused={paused}
                initial={reducedMotion || paused ? false : {
                  opacity: 0,
                  y: -8,
                  boxShadow: "0 0 22px color-mix(in srgb, var(--module-color) 20%, transparent)",
                }}
                animate={{
                  opacity: 1,
                  y: 0,
                  boxShadow: "0 0 0 color-mix(in srgb, var(--module-color) 0%, transparent)",
                }}
                exit={reducedMotion || paused ? undefined : { opacity: 0, y: 8 }}
                transition={{ duration: 0.56, ease: "easeOut" }}
              >
                <span className="operational-feed-icon"><Icon aria-hidden="true" /></span>
                <div className="operational-feed-copy">
                  <span>
                    {presentation.compactLabel}
                    {event.prioridade !== "INFO" ? <i className="operational-severity-marker" aria-hidden="true" /> : null}
                  </span>
                  <strong>{event.titulo}</strong>
                  {event.descricao ? <small>{event.descricao}</small> : null}
                </div>
                <div className="operational-feed-meta">
                  {formattedValue ? <b>{formattedValue}</b> : null}
                  <time dateTime={event.ocorridoEm}>{relativeOperationalTime(event.ocorridoEm, now)}</time>
                </div>
              </motion.article>
            );
          })}
        </AnimatePresence>
        {events.length === 0 ? (
          <div className="operational-feed-empty">Aguardando a próxima atividade operacional.</div>
        ) : null}
      </div>
    </aside>
  );
}
