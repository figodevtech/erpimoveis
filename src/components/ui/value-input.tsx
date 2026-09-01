"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";

export type ValueInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "type" | "value" | "defaultValue" | "onChange" | "inputMode"
> & {
  value?: number | null;
  onValueChange?: (value: number) => void;
  /** Casas decimais aceitas pela máscara. Padrão 2 (centavos). */
  decimals?: number;
  /** Permite valor negativo: digitar "-" inverte o sinal. */
  allowNegative?: boolean;
  /** Compatibilidade com os usos existentes durante a padronização. */
  price?: number | null;
  setPrice?: (value: number) => void;
};

function createFormatter(decimals: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function toUnits(value: number | null | undefined, decimals: number, allowNegative: boolean) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return 0;
  const units = Math.round(number * 10 ** decimals);
  return allowNegative ? units : Math.max(0, units);
}

/** Mantem o 18 historico no caso padrao (2 casas, sem sinal) e cresce a partir dele. */
function defaultMaxLength(decimals: number, allowNegative: boolean) {
  return 16 + decimals + (allowNegative ? 1 : 0);
}

export const ValueInput = React.forwardRef<HTMLInputElement, ValueInputProps>(
  (
    {
      value,
      onValueChange,
      price,
      setPrice,
      decimals = 2,
      allowNegative = false,
      maxLength,
      placeholder = "R$ 0,00",
      ...props
    },
    ref,
  ) => {
    const numericValue = value ?? price ?? 0;
    const notifyChange = onValueChange ?? setPrice;
    const [units, setUnits] = React.useState(() => toUnits(numericValue, decimals, allowNegative));

    const formatter = React.useMemo(() => createFormatter(decimals), [decimals]);
    const factor = 10 ** decimals;

    React.useEffect(() => {
      const nextUnits = toUnits(numericValue, decimals, allowNegative);
      setUnits((current) => (current === nextUnits ? current : nextUnits));
    }, [numericValue, decimals, allowNegative]);

    const handleChange = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const raw = event.target.value;
        // O "-" do próprio texto formatado entra na contagem: digitar outro volta ao positivo.
        const isNegative = allowNegative && (raw.match(/-/g)?.length ?? 0) % 2 === 1;

        const digits = raw.replace(/\D/g, "");
        const parsed = digits ? Number.parseInt(digits, 10) : 0;
        const magnitude = Number.isFinite(parsed) ? parsed : 0;
        const nextUnits = isNegative ? -magnitude : magnitude;

        setUnits(nextUnits);
        notifyChange?.(nextUnits / factor);
      },
      [notifyChange, allowNegative, factor],
    );

    return (
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode="numeric"
        value={formatter.format(units / factor)}
        onChange={handleChange}
        placeholder={placeholder}
        maxLength={maxLength ?? defaultMaxLength(decimals, allowNegative)}
      />
    );
  },
);

ValueInput.displayName = "ValueInput";

export default ValueInput;
