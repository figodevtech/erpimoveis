import { TriangleAlert } from "lucide-react";

import type { OperationalAttention } from "@/lib/central-operacional/contracts";
import { formatOperationalEventValue } from "@/lib/central-operacional/formatters";
import { operationalPresentationFor } from "@/lib/central-operacional/presentation";

export function OperationalAlert({
  attention,
  hideValues,
  paused,
}: {
  attention: OperationalAttention;
  hideValues: boolean;
  paused: boolean;
}) {
  const presentation = operationalPresentationFor(attention.modulo);
  const Icon = presentation.icon;

  return (
    <div
      className={`operational-map-alert priority-${attention.prioridade.toLowerCase()}`}
      data-module={attention.modulo}
      data-priority={attention.prioridade}
      data-active="true"
      data-paused={paused}
      role="status"
    >
      <span className="operational-alert-module" title={presentation.label}>
        <Icon aria-hidden="true" />
        {presentation.compactLabel}
      </span>
      <TriangleAlert className="operational-alert-severity" aria-hidden="true" />
      <span className="operational-alert-copy"><strong>{attention.titulo}</strong>{attention.detalhe ? ` · ${attention.detalhe}` : ""}</span>
      {attention.valor !== null ? <b>{formatOperationalEventValue(attention.valor, null, hideValues)}</b> : null}
    </div>
  );
}
