"use client";

import { useEffect, useState } from "react";

/** Depois da primeira carga, atualizações preservam a página e seus diálogos. */
export function useInitialPageLoading(pending: boolean) {
  const [initial, setInitial] = useState(true);
  useEffect(() => {
    if (!pending) setInitial(false);
  }, [pending]);
  return initial && pending;
}
