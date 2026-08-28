"use client";

import * as React from "react";
import { ExternalLink, Lock, RotateCcw, TriangleAlert, X } from "lucide-react";
import { motion } from "motion/react";

import type {
  OperationalDetailField,
  OperationalDetailRestriction,
  OperationalEvent,
  OperationalEventDetail,
} from "@/lib/central-operacional/contracts";
import {
  formatOperationalIndicator,
  relativeOperationalTime,
} from "@/lib/central-operacional/formatters";
import {
  OPERATIONAL_EXPANSION_EXIT,
  OPERATIONAL_EXPANSION_SPRING,
} from "@/lib/central-operacional/motion-timing";
import { operationalPresentationFor } from "@/lib/central-operacional/presentation";
import { useOperationalReducedMotion } from "../hooks/use-operational-reduced-motion";
import { useOperationalEventDetail } from "../hooks/use-operational-event-detail";

/** Geometria do card de origem, para a expansão nascer de onde o usuário clicou. */
export type ExpansionOrigin = { top: number; height: number };

const RESTRICTION_COPY: Record<OperationalDetailRestriction, string> = {
  CLIENTE_SEM_PERMISSAO: "Dados do cliente restritos pelas suas permissões",
  VENDAS_SEM_PERMISSAO: "Detalhes da venda restritos pelas suas permissões",
  FINANCEIRO_SEM_PERMISSAO: "Valores financeiros restritos pelas suas permissões",
};

function dataOperacional(iso: string, comHora: boolean) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(comHora ? { hour: "2-digit" as const, minute: "2-digit" as const } : {}),
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

/**
 * Formata um campo já no cliente.
 *
 * O servidor manda o valor cru de propósito: só aqui existe a preferência local
 * de ocultar dinheiro, e formatar antes tornaria `R$ ••••••` impossível.
 */
function valorDoCampo(campo: OperationalDetailField, hideValues: boolean) {
  if (campo.tipo === "MOEDA") {
    return formatOperationalIndicator(
      { tipo: "MOEDA", valor: campo.numero ?? 0, sufixo: null },
      hideValues,
    );
  }
  if (campo.tipo === "QUANTIDADE") {
    const quantia = (campo.numero ?? 0).toLocaleString("pt-BR");
    return campo.sufixo ? `${quantia} ${campo.sufixo}` : quantia;
  }
  if (campo.tipo === "DATA" || campo.tipo === "DATAHORA") {
    return campo.texto ? dataOperacional(campo.texto, campo.tipo === "DATAHORA") : "—";
  }
  return campo.texto ?? "—";
}

function DetalheCarregado({
  detail,
  hideValues,
}: {
  detail: OperationalEventDetail;
  hideValues: boolean;
}) {
  return (
    <>
      {detail.indicadores.length > 0 ? (
        <div className="operational-detail-indicators">
          {detail.indicadores.map((indicador) => (
            <article key={indicador.chave}>
              <small>{indicador.rotulo}</small>
              <strong>{formatOperationalIndicator(indicador, hideValues)}</strong>
            </article>
          ))}
        </div>
      ) : null}

      {detail.secoes.map((secao) => (
        <section className="operational-detail-section" key={secao.id}>
          <h3>{secao.titulo}</h3>
          <dl>
            {secao.campos.map((campo) => (
              <div key={campo.chave}>
                <dt>{campo.rotulo}</dt>
                <dd>{valorDoCampo(campo, hideValues)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      {detail.vinculos.length > 0 ? (
        <section className="operational-detail-section" key="vinculos">
          <h3>Documentos</h3>
          <div className="operational-detail-links">
            {detail.vinculos.map((vinculo) => {
              const conteudo = (
                <>
                  <strong>{vinculo.rotulo}</strong>
                  {vinculo.detalhe ? <small>{vinculo.detalhe}</small> : null}
                  {vinculo.valor !== null ? (
                    <b>
                      {formatOperationalIndicator(
                        { tipo: "MOEDA", valor: vinculo.valor, sufixo: null },
                        hideValues,
                      )}
                    </b>
                  ) : null}
                </>
              );

              return vinculo.href ? (
                <a
                  key={`${vinculo.tipo}-${vinculo.id}`}
                  className="operational-detail-link"
                  href={vinculo.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {conteudo}
                  <ExternalLink aria-hidden="true" />
                </a>
              ) : (
                <span key={`${vinculo.tipo}-${vinculo.id}`} className="operational-detail-link" data-inert="true">
                  {conteudo}
                </span>
              );
            })}
          </div>
        </section>
      ) : null}

      {detail.restricoes.length > 0 ? (
        <p className="operational-detail-restriction">
          <Lock aria-hidden="true" />
          {detail.restricoes.map((restricao) => RESTRICTION_COPY[restricao]).join(" · ")}
        </p>
      ) : null}
    </>
  );
}

export function EventDetailPanel({
  event,
  origin,
  hideValues,
  paused,
  now,
  onClose,
}: {
  event: OperationalEvent;
  origin: ExpansionOrigin | null;
  hideValues: boolean;
  paused: boolean;
  now: number;
  onClose: () => void;
}) {
  const reducedMotion = useOperationalReducedMotion();
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const { detail, loading, error, retry } = useOperationalEventDetail(event.id);
  const presentation = operationalPresentationFor(event.modulo);
  const Icon = presentation.icon;
  const titleId = `operational-detail-title-${event.id}`;
  const shouldAnimate = !paused && !reducedMotion;

  React.useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const handleKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === "Escape") {
        keyboardEvent.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Só altura: nasce na posição e no tamanho do card clicado e cresce até
  // preencher a lista. Sem `scaleY`, que distorceria o texto no caminho.
  const inicio = origin
    ? { top: origin.top, height: origin.height, opacity: 0.6 }
    : { top: 0, height: "100%" as const, opacity: 0 };

  return (
    <motion.section
      className="operational-detail-panel"
      data-module={event.modulo}
      data-priority={event.prioridade}
      data-paused={paused}
      role="dialog"
      aria-labelledby={titleId}
      initial={shouldAnimate ? inicio : false}
      animate={{ top: 0, height: "100%", opacity: 1 }}
      exit={
        shouldAnimate
          ? { ...inicio, opacity: 0, transition: OPERATIONAL_EXPANSION_EXIT }
          : { opacity: 0 }
      }
      transition={shouldAnimate ? OPERATIONAL_EXPANSION_SPRING : { duration: 0 }}
      onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()}
    >
      <header className="operational-detail-header">
        <span className="operational-detail-icon">
          <Icon aria-hidden="true" />
        </span>
        <div>
          <small>{presentation.compactLabel}</small>
          <h2 id={titleId}>{detail?.titulo ?? event.titulo}</h2>
          <span className="operational-detail-subtitle">
            {detail?.referencia ?? "Carregando…"}
            {detail?.subtitulo ? ` · ${detail.subtitulo}` : ""}
          </span>
        </div>
        <div className="operational-detail-header-side">
          {detail?.status ? (
            <span className="operational-detail-status" data-priority={detail.status.prioridade}>
              {detail.status.rotulo}
            </span>
          ) : null}
          <time dateTime={event.ocorridoEm}>{relativeOperationalTime(event.ocorridoEm, now)}</time>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="operational-detail-close"
          onClick={onClose}
          aria-label={`Fechar detalhes de ${event.titulo}`}
          title="Fechar"
        >
          <X aria-hidden="true" />
        </button>
      </header>

      <div className="operational-detail-body">
        {loading ? (
          <div className="operational-detail-loading" role="status">
            <i aria-hidden="true" />
            <i aria-hidden="true" />
            <i aria-hidden="true" />
            <span>Consultando o registro de origem…</span>
          </div>
        ) : error ? (
          <div className="operational-detail-error" role="alert">
            <TriangleAlert aria-hidden="true" />
            <p>{error}</p>
            <button type="button" onClick={retry}>
              <RotateCcw aria-hidden="true" /> Tentar novamente
            </button>
          </div>
        ) : detail ? (
          <>
            {detail.estado === "ENTIDADE_INDISPONIVEL" ? (
              <p className="operational-detail-restriction">
                <TriangleAlert aria-hidden="true" />
                O registro de origem não está mais disponível. Abaixo, o que ficou guardado no evento.
              </p>
            ) : null}
            <DetalheCarregado detail={detail} hideValues={hideValues} />
          </>
        ) : null}
      </div>
    </motion.section>
  );
}
