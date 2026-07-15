"use client";

import { useEffect, useMemo, useState } from "react";

// Usa o fuso do navegador quando estiver no client;
// no SSR cai no padrão de Fortaleza pra evitar surpresas:
const DEFAULT_TZ = "America/Fortaleza";
const getTimeZone = () =>
  typeof window !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : DEFAULT_TZ;

export default function DateTimeBadge() {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const tz = getTimeZone();

  // Cria formatadores só quando o fuso muda
  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
        timeZone: tz,
      }),
    [tz]
  );

  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        // second: "2-digit", // habilite se quiser segundos
        hour12: false,
        timeZone: tz,
      }),
    [tz]
  );

  useEffect(() => {
    setMounted(true);
    const tick = () => setNow(new Date());
    tick(); // inicializa
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Skeleton enquanto não monta: evita hydration mismatch e mantém layout
  if (!mounted || !now) {
    return (
      <div
        className="hidden h-8 w-72 animate-pulse rounded-md bg-muted/60 md:flex"
        aria-hidden="true"
      />
    );
  }

  const dateStr = dateFmt.format(now); // ex: segunda-feira, 03 de novembro de 2025
  const timeStr = timeFmt.format(now); // ex: 14:07

  return (
    <div className="hidden items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground dark:border-white/15 dark:bg-muted md:flex">
      <span className="truncate">{dateStr}</span>
      <span className="select-none opacity-60">•</span>
      {/* tabular-nums deixa os dígitos monoespaçados sem trocar a fonte do header */}
      <time className="tabular-nums">{timeStr}</time>
    </div>
  );
}
