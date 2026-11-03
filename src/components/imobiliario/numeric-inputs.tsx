"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

type Common = {
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
};

/**
 * Campo de texto (não `type="number"`) que só aceita dígitos: sem setas, sem rolagem do mouse
 * mudando o valor e sem "e"/"-" do campo nativo. Vazio enquanto se digita; ao sair, volta para
 * `fallback` (ex.: capacidade mínima 1).
 */
export function IntegerInput({
  value,
  onChange,
  fallback = 0,
  maxDigits = 4,
  ...rest
}: Common & {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  fallback?: number;
  maxDigits?: number;
}) {
  return (
    <Input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={value == null ? "" : String(value)}
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, "").slice(0, maxDigits);
        onChange(digits === "" ? null : Number(digits));
      }}
      onBlur={() => {
        if (value == null || value < fallback) onChange(fallback);
      }}
    />
  );
}

/** "45.5" → "45,5" para exibir no padrão brasileiro. */
const toText = (value: number | null | undefined) => (value == null ? "" : String(value).replace(".", ","));

/**
 * Número com vírgula e no máximo `decimals` casas (ex.: área 45,75). Ponto digitado vira
 * vírgula. O texto fica local enquanto se digita ("45," ainda não é número); o valor numérico
 * vai para fora a cada tecla.
 */
export function DecimalInput({
  value,
  onChange,
  decimals = 2,
  maxIntegerDigits = 7,
  ...rest
}: Common & {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  decimals?: number;
  maxIntegerDigits?: number;
}) {
  const [text, setText] = useState(() => toText(value));
  const [editing, setEditing] = useState(false);

  // Valor trocado por fora (cadastro carregado, formulário limpo): atualiza o texto.
  useEffect(() => {
    if (!editing) setText(toText(value));
  }, [value, editing]);

  const sanitize = (raw: string) => {
    const cleaned = raw.replace(/\./g, ",").replace(/[^\d,]/g, "");
    const [integer = "", ...rest] = cleaned.split(",");
    const intPart = integer.slice(0, maxIntegerDigits);
    if (!cleaned.includes(",")) return intPart;
    return `${intPart || "0"},${rest.join("").slice(0, decimals)}`;
  };

  return (
    <Input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={text}
      onFocus={() => setEditing(true)}
      onChange={(event) => {
        const next = sanitize(event.target.value);
        setText(next);
        const number = next === "" ? null : Number(next.replace(",", "."));
        onChange(number == null || Number.isNaN(number) ? null : number);
      }}
      onBlur={() => {
        setEditing(false);
        // "45," ao sair vira "45"; o número já estava certo.
        setText(toText(text === "" ? null : Number(text.replace(",", "."))));
      }}
    />
  );
}
