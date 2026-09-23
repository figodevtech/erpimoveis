"use client";

import { Input } from "@/components/ui/input";
import ValueInput from "@/components/ui/value-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TipoDesconto } from "../tipos";

type CampoDescontoProps = {
  tipo?: TipoDesconto | null;
  valor?: number | null;
  onTipoChange: (tipo: TipoDesconto | null) => void;
  onValorChange: (valor: number) => void;
  className?: string;
  selectClassName?: string;
  inputClassName?: string;
  ariaLabel?: string;
};

export function CampoDesconto({
  tipo,
  valor,
  onTipoChange,
  onValorChange,
  className,
  selectClassName,
  inputClassName,
  ariaLabel,
}: CampoDescontoProps) {
  const temDesconto = Boolean(tipo);
  const isPorcentagem = tipo === "PORCENTAGEM";

  return (
    <div className={className ?? "grid grid-cols-[112px_112px] gap-2"}>
      <Select
        value={tipo ?? "NONE"}
        onValueChange={(value) => {
          const next = value === "NONE" ? null : (value as TipoDesconto);
          onTipoChange(next);
          if (!next) onValorChange(0);
        }}
      >
        <SelectTrigger className={selectClassName ?? "h-8"} aria-label={ariaLabel ? `Tipo: ${ariaLabel}` : undefined}>
          <SelectValue placeholder="Sem desconto" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="NONE">Sem</SelectItem>
          <SelectItem value="FIXO">Fixo</SelectItem>
          <SelectItem value="PORCENTAGEM">%</SelectItem>
        </SelectContent>
      </Select>

      <div className="relative">
        {isPorcentagem ? (
          <Input
            aria-label={ariaLabel ? `Valor: ${ariaLabel}` : undefined}
            type="number"
            min={0}
            max={100}
            step="0.01"
            inputMode="decimal"
            disabled={!temDesconto}
            value={temDesconto && Number(valor ?? 0) > 0 ? String(valor) : ""}
            placeholder={temDesconto ? "0" : "-"}
            onChange={(event) => {
              const raw = event.target.value.trim().replace(",", ".");
              onValorChange(raw ? Number(raw) : 0);
            }}
            className={[inputClassName ?? "h-8", "pr-7"].filter(Boolean).join(" ")}
          />
        ) : (
          <ValueInput
            aria-label={ariaLabel ? `Valor: ${ariaLabel}` : undefined}
            value={valor ?? 0}
            onValueChange={onValorChange}
            disabled={!temDesconto}
            className={inputClassName ?? "h-8"}
            placeholder={temDesconto ? "R$ 0,00" : "-"}
          />
        )}
        {isPorcentagem ? (
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            %
          </span>
        ) : null}
      </div>
    </div>
  );
}
