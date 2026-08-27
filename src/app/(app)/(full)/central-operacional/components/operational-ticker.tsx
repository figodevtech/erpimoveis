import { TriangleAlert } from "lucide-react";

import type { OperationalAttention } from "@/lib/central-operacional/contracts";
import { formatOperationalEventValue } from "@/lib/central-operacional/formatters";
import { operationalPresentationFor } from "@/lib/central-operacional/presentation";

function TickerItems({
  attentions,
  hideValues,
  paused,
}: {
  attentions: OperationalAttention[];
  hideValues: boolean;
  paused: boolean;
}) {
  return attentions.map((attention) => {
    const presentation = operationalPresentationFor(attention.modulo);
    const Icon = presentation.icon;

    return (
      <span
        className={`operational-ticker-item priority-${attention.prioridade.toLowerCase()}`}
        data-module={attention.modulo}
        data-priority={attention.prioridade}
        data-active="false"
        data-paused={paused}
        key={attention.id}
      >
        <span className="operational-ticker-category"><Icon aria-hidden="true" />{presentation.compactLabel}</span>
        <TriangleAlert className="operational-ticker-severity" aria-hidden="true" />
        <b>{attention.titulo}</b>
        {attention.detalhe ? <span>{attention.detalhe}</span> : null}
        {attention.valor !== null ? (
          <strong>{formatOperationalEventValue(attention.valor, null, hideValues)}</strong>
        ) : null}
      </span>
    );
  });
}

export function OperationalTicker({
  attentions,
  hideValues,
  paused,
}: {
  attentions: OperationalAttention[];
  hideValues: boolean;
  paused: boolean;
}) {
  if (attentions.length === 0) {
    return (
      <footer className="operational-ticker is-clear" data-paused={paused}>
        <span className="operational-ticker-label">ATENÇÃO</span>
        <div>Nenhuma pendência crítica identificada no snapshot atual.</div>
      </footer>
    );
  }

  return (
    <footer
      className={`operational-ticker ${paused ? "is-paused" : ""}`}
      data-paused={paused}
      aria-label="Pendências que exigem atenção"
    >
      <span className="operational-ticker-label">ATENÇÃO</span>
      <div className="operational-ticker-viewport">
        <div className="operational-ticker-track">
          <TickerItems attentions={attentions} hideValues={hideValues} paused={paused} />
          <TickerItems attentions={attentions} hideValues={hideValues} paused={paused} />
        </div>
      </div>
    </footer>
  );
}
