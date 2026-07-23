"use client";

import ValueInput from "@/components/ui/value-input";

type Props = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  disabled?: boolean;
};

export function CampoPreco({ value, onChange, disabled }: Props) {
  return (
    <ValueInput
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      className="h-8 w-[120px] text-right tabular-nums"
    />
  );
}
