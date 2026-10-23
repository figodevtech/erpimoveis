"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";

export type ValueInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "type" | "value" | "defaultValue" | "onChange" | "inputMode"
> & {
  value?: number | null;
  onValueChange?: (value: number) => void;
  /** Mantém um filtro vazio como "sem limite", sem convertê-lo em zero. */
  allowEmpty?: boolean;
  onEmpty?: () => void;
  /** Casas decimais aceitas. Padrão 2 (centavos). */
  decimals?: number;
  /** Permite valor negativo. */
  allowNegative?: boolean;
  /**
   * "mask" (padrão): os dígitos entram da direita para a esquerda, como centavos.
   * "decimal": digitação livre — a vírgula é digitada e as casas não são obrigatórias
   * ("443,32" vale 443,32, sem precisar completar os zeros).
   */
  mode?: "mask" | "decimal";
  /** Compatibilidade com os usos existentes durante a padronização. */
  price?: number | null;
  setPrice?: (value: number) => void;
};

function toUnits(value: number, decimals: number, allowNegative: boolean) {
  const units = Math.round(value * 10 ** decimals);
  return allowNegative ? units : Math.max(0, units);
}

/** Mantem o 18 historico no caso padrao (2 casas, sem sinal) e cresce a partir dele. */
function defaultMaxLength(decimals: number, allowNegative: boolean) {
  return 16 + decimals + (allowNegative ? 1 : 0);
}

/** Posição do separador decimal: o último "," ou "." digitado; os anteriores são milhar. */
function lastSeparator(text: string) {
  return Math.max(text.lastIndexOf(","), text.lastIndexOf("."));
}

/** Deixa no texto apenas o que forma um decimal em pt-BR, respeitando o limite de casas. */
function sanitizeDraft(raw: string, decimals: number, allowNegative: boolean) {
  const sinal = allowNegative && raw.includes("-") ? "-" : "";
  const limpo = raw.replace(/[^\d.,]/g, "");

  const corte = lastSeparator(limpo);
  if (decimals <= 0 || corte < 0) return sinal + limpo.replace(/[.,]/g, "");

  const inteiro = limpo.slice(0, corte);
  const fracao = limpo
    .slice(corte + 1)
    .replace(/[.,]/g, "")
    .slice(0, decimals);

  return sinal + inteiro + limpo[corte] + fracao;
}

function parseDraft(draft: string) {
  const negativo = draft.includes("-");
  const corte = lastSeparator(draft);

  const digitos =
    corte < 0
      ? draft.replace(/\D/g, "")
      : `${draft.slice(0, corte).replace(/\D/g, "")}.${draft.slice(corte + 1).replace(/\D/g, "")}`;

  const parsed = Number(digitos);
  if (!Number.isFinite(parsed)) return 0;
  // Evita o -0, que o Intl formataria como "-R$ 0,00".
  return negativo && parsed !== 0 ? -parsed : parsed;
}

export const ValueInput = React.forwardRef<HTMLInputElement, ValueInputProps>(
  (
    {
      value,
      onValueChange,
      allowEmpty = false,
      onEmpty,
      price,
      setPrice,
      decimals = 2,
      allowNegative = false,
      mode = "mask",
      maxLength,
      placeholder = "R$ 0,00",
      onFocus,
      onBlur,
      ...props
    },
    ref,
  ) => {
    const rawValue = Number(value ?? price ?? 0);
    const numericValue = Number.isFinite(rawValue) ? rawValue : 0;
    const notifyChange = onValueChange ?? setPrice;
    const factor = 10 ** decimals;

    const currencyFormatter = React.useMemo(
      () =>
        new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
          // Na máscara todas as casas são digitadas, então min = max. Na digitação
          // livre o valor aparece com as casas que tiver, sem zeros de enchimento.
          minimumFractionDigits: mode === "decimal" ? Math.min(2, decimals) : decimals,
          maximumFractionDigits: mode === "decimal" ? Math.max(2, decimals) : decimals,
        }),
      [decimals, mode],
    );

    /** Texto simples para editar: sem "R$" e sem separador de milhar. */
    const plainFormatter = React.useMemo(
      () =>
        new Intl.NumberFormat("pt-BR", {
          useGrouping: false,
          minimumFractionDigits: 0,
          maximumFractionDigits: decimals,
        }),
      [decimals],
    );

    // Máscara: guarda o valor em unidades inteiras (centavos e afins).
    const [units, setUnits] = React.useState(() => toUnits(numericValue, decimals, allowNegative));
    // Digitação livre: guarda o texto enquanto o campo está em foco (null = fora de edição).
    const [draft, setDraft] = React.useState<string | null>(null);

    React.useEffect(() => {
      const nextUnits = toUnits(numericValue, decimals, allowNegative);
      setUnits((current) => (current === nextUnits ? current : nextUnits));
    }, [numericValue, decimals, allowNegative]);

    const handleChange = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const raw = event.target.value;
        if (allowEmpty && !/\d/.test(raw)) {
          setUnits(0);
          setDraft(mode === "decimal" ? "" : null);
          onEmpty?.();
          return;
        }

        if (mode === "decimal") {
          const next = sanitizeDraft(raw, decimals, allowNegative);
          setDraft(next);
          notifyChange?.(parseDraft(next));
          return;
        }

        // O "-" do próprio texto formatado entra na contagem: digitar outro volta ao positivo.
        const isNegative = allowNegative && (raw.match(/-/g)?.length ?? 0) % 2 === 1;

        const digits = raw.replace(/\D/g, "");
        const parsed = digits ? Number.parseInt(digits, 10) : 0;
        const magnitude = Number.isFinite(parsed) ? parsed : 0;
        const nextUnits = isNegative ? -magnitude : magnitude;

        setUnits(nextUnits);
        notifyChange?.(nextUnits / factor);
      },
      [mode, decimals, allowNegative, notifyChange, factor, allowEmpty, onEmpty],
    );

    const handleFocus = React.useCallback(
      (event: React.FocusEvent<HTMLInputElement>) => {
        // Zero entra como campo vazio para o usuário não ter que apagar o "0" antes de digitar.
        if (mode === "decimal") setDraft(numericValue === 0 ? "" : plainFormatter.format(numericValue));
        onFocus?.(event);
      },
      [mode, numericValue, plainFormatter, onFocus],
    );

    const handleBlur = React.useCallback(
      (event: React.FocusEvent<HTMLInputElement>) => {
        if (mode === "decimal") setDraft(null);
        onBlur?.(event);
      },
      [mode, onBlur],
    );

    const displayValue =
      mode === "decimal"
        ? draft ?? currencyFormatter.format(numericValue)
        : currencyFormatter.format(units / factor);

    return (
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode={mode === "decimal" ? "decimal" : "numeric"}
        value={allowEmpty && value == null ? draft ?? "" : displayValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        maxLength={maxLength ?? defaultMaxLength(decimals, allowNegative)}
      />
    );
  },
);

ValueInput.displayName = "ValueInput";

export default ValueInput;
