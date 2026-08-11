"use client";

import ValueInput from "@/components/ui/value-input";

type Props = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  disabled?: boolean;
  className?: string;
};

export function CampoPreco({ value, onChange, disabled, className }: Props) {
  return (
    <ValueInput
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      className={className ?? "h-8 w-[120px] text-right tabular-nums"}
    />
  );
}
