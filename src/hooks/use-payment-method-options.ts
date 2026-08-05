"use client";

import { useCallback, useEffect, useState } from "react";
import {
  formatPaymentMethodLabel,
  type PaymentMethodItem,
} from "@/lib/payment-methods";

export function usePaymentMethodOptions() {
  const [options, setOptions] = useState<PaymentMethodItem[]>([]);
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

      setOptions(
        (body.data ?? [])
          .map((item) => String(item.value ?? "").trim().toUpperCase())
          .filter(Boolean)
          .map((value) => ({ value, label: formatPaymentMethodLabel(value) })),
      );
    } catch (cause) {
      setOptions([]);
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
