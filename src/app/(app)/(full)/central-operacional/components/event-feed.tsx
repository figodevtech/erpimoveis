"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";

import type { OperationalEvent } from "@/lib/central-operacional/contracts";
import {
  formatOperationalEventValue,
  relativeOperationalTime,
} from "@/lib/central-operacional/formatters";
import { operationalPresentationFor } from "@/lib/central-operacional/presentation";
import { useOperationalReducedMotion } from "../hooks/use-operational-reduced-motion";
import { EventDetailPanel, type ExpansionOrigin } from "./event-detail-panel";

export function EventFeed({
  events,
  eventCount,
  counterLabel,
  now,
  hideValues,
  paused,
  expandedEventId,
  onExpand,
  onClose,
}: {
  events: OperationalEvent[];
  eventCount: number;
  counterLabel: string;
  now: number;
  hideValues: boolean;
  paused: boolean;
  expandedEventId: string | null;
  onExpand: (eventId: string, origin: ExpansionOrigin | null) => void;
  onClose: () => void;
}) {
  const reducedMotion = useOperationalReducedMotion();
  const listRef = React.useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = React.useState<ExpansionOrigin | null>(null);

  const visiveis = events.slice(0, 12);
  // O evento aberto continua renderizado mesmo se sair dos 12 visíveis: o feed
  // segue recebendo eventos novos atrás do painel, e o card em leitura não pode
  // desaparecer por causa disso.
  const expandido = expandedEventId
    ? events.find((event) => event.id === expandedEventId) ?? null
    : null;

  /** Mede o card clicado para a expansão nascer exatamente de onde ele está. */
  const abrir = (eventId: string, elemento: HTMLElement | null) => {
    const lista = listRef.current;
    if (elemento && lista) {
      const alvo = elemento.getBoundingClientRect();
      const caixa = lista.getBoundingClientRect();
      const medida = { top: alvo.top - caixa.top, height: alvo.height };
      setOrigin(medida);
      onExpand(eventId, medida);
      return;
    }
    setOrigin(null);
    onExpand(eventId, null);
  };

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

      {/* O viewport existe para o painel expandido se ancorar nele: dentro da
          lista rolável, um `position: absolute` acompanharia o scroll do
          conteúdo e sairia de lugar. */}
      <div className="operational-feed-viewport" ref={listRef}>
      <div className="operational-feed-list" role="log" aria-live="polite" aria-relevant="additions">
        <AnimatePresence initial={false} mode="popLayout">
          {visiveis.map((event) => {
            const presentation = operationalPresentationFor(event.modulo);
            const Icon = presentation.icon;
            const formattedValue = formatOperationalEventValue(event.valor, event.quantidade, hideValues);
            const aberto = expandedEventId === event.id;
            return (
              <motion.article
                layout={!reducedMotion && !paused}
                key={event.id}
                className={`operational-feed-item priority-${event.prioridade.toLowerCase()}`}
                data-module={event.modulo}
                data-priority={event.prioridade}
                data-active="false"
                data-expanded={aberto}
                data-paused={paused}
                role="button"
                tabIndex={0}
                aria-expanded={aberto}
                aria-haspopup="dialog"
                aria-label={`Abrir detalhes de ${event.titulo}`}
                onMouseDown={(pointerEvent) => pointerEvent.stopPropagation()}
                onClick={(pointerEvent) =>
                  aberto ? onClose() : abrir(event.id, pointerEvent.currentTarget)
                }
                onKeyDown={(keyboardEvent) => {
                  if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ") return;
                  keyboardEvent.preventDefault();
                  if (aberto) onClose();
                  else abrir(event.id, keyboardEvent.currentTarget);
                }}
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

      <AnimatePresence>
        {expandido ? (
          <EventDetailPanel
            key={expandido.id}
            event={expandido}
            origin={origin}
            hideValues={hideValues}
            paused={paused}
            now={now}
            onClose={onClose}
          />
        ) : null}
      </AnimatePresence>
      </div>
    </aside>
  );
}
