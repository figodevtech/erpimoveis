"use client";

import { useCallback, useEffect, useState } from "react";
import {
  METODOS_PAGAMENTO_PADRAO,
  formatPaymentMethodLabel,
  type PaymentMethodItem,
} from "@/lib/payment-methods";

/**
 * Nunca devolve lista vazia.
 *
 * Todo seletor de forma de pagamento passa por aqui, e um seletor sem opcao
 * nenhuma — enquanto a busca nao voltou, ou se ela falhar — deixa o usuario sem
 * saida. O fallback e a lista fixa; ela pode estar incompleta, mas e melhor que
 * um campo vazio.
 */
const PADRAO: PaymentMethodItem[] = METODOS_PAGAMENTO_PADRAO.map((value) => ({
  value,
  label: formatPaymentMethodLabel(value),
}));

export function usePaymentMethodOptions() {
  const [options, setOptions] = useState<PaymentMethodItem[]>(PADRAO);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/payment-methods", { cache: "no-store" });
      const body = (await response.json()) as {
        data?: Array<{ value?: unknown }>;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Falha ao carregar formas de pagamento.");

      const doBanco = (body.data ?? [])
        .map((item) => String(item.value ?? "").trim().toUpperCase())
        .filter(Boolean)
        .map((value) => ({ value, label: formatPaymentMethodLabel(value) }));

      setOptions(doBanco.length > 0 ? doBanco : PADRAO);
    } catch (cause) {
      setOptions(PADRAO);
      setError(cause instanceof Error ? cause.message : "Falha ao carregar formas de pagamento.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { options, isLoading, error, reload };
}
