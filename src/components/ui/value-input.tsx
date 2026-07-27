"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";

export type ValueInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "type" | "value" | "defaultValue" | "onChange" | "inputMode"
> & {
  value?: number | null;
  onValueChange?: (value: number) => void;
  /** Compatibilidade com os usos existentes durante a padronização. */
  price?: number | null;
  setPrice?: (value: number) => void;
};

const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function toCents(value: number | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.round(number * 100)) : 0;
}

export const ValueInput = React.forwardRef<HTMLInputElement, ValueInputProps>(
  ({ value, onValueChange, price, setPrice, maxLength = 18, placeholder = "R$ 0,00", ...props }, ref) => {
    const numericValue = value ?? price ?? 0;
    const notifyChange = onValueChange ?? setPrice;
    const [cents, setCents] = React.useState(() => toCents(numericValue));

    React.useEffect(() => {
      const nextCents = toCents(numericValue);
      setCents((current) => (current === nextCents ? current : nextCents));
    }, [numericValue]);

    const handleChange = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const digits = event.target.value.replace(/\D/g, "");
        const nextCents = digits ? Number.parseInt(digits, 10) : 0;
        const safeCents = Number.isFinite(nextCents) ? nextCents : 0;
        setCents(safeCents);
        notifyChange?.(safeCents / 100);
      },
      [notifyChange],
    );

    return (
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={brlFormatter.format(cents / 100)}
        onChange={handleChange}
        placeholder={placeholder}
        maxLength={maxLength}
      />
    );
  },
);

ValueInput.displayName = "ValueInput";

export default ValueInput;
