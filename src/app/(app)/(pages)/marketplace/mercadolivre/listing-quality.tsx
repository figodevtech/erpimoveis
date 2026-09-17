"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { MercadoLivreListingQuality as ListingQuality } from "@/lib/integrations/mercadolivre-quality";

// O Mercado Livre abre o detalhe dos objetivos ao passar o mouse. O clique
// continua valendo, para quem usa toque ou teclado.
const HOVER_DELAY_MS = 120;

export function MercadoLivreListingQuality({
  health,
  quality,
  className,
}: {
  health?: number | null;
  quality?: ListingQuality | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timeout.current) clearTimeout(timeout.current);
  }, []);

  const scheduleOpen = (next: boolean) => {
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setOpen(next), HOVER_DELAY_MS);
  };

  const score = quality?.score ?? (health != null && Number.isFinite(Number(health)) ? Number(health) * 100 : null);
  if (score == null) return null;

  const goals = quality?.goals ?? [];
  const label = `Qualidade ${Math.round(score)}%`;
  if (!goals.length) return <span className={className}>{label}</span>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`underline decoration-dotted underline-offset-2 hover:text-foreground ${className ?? ""}`}
          onMouseEnter={() => scheduleOpen(true)}
          onMouseLeave={() => scheduleOpen(false)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
        >
          {label} · {goals.length} {goals.length === 1 ? "objetivo" : "objetivos"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 space-y-2 p-3"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onMouseEnter={() => scheduleOpen(true)}
        onMouseLeave={() => scheduleOpen(false)}
      >
        <div>
          <p className="text-sm font-medium">Qualidade do anúncio</p>
          <p className="text-xs text-muted-foreground">
            {goals.length === 1 ? "1 objetivo a alcançar" : `${goals.length} objetivos a alcançar`}
          </p>
        </div>
        <ul className="space-y-2">
          {goals.map((goal) => (
            <li key={goal.key} className="rounded-md border p-2">
              {goal.group ? <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{goal.group}</p> : null}
              <p className="text-xs font-medium">{goal.title}</p>
              {goal.detail ? <p className="mt-0.5 text-[11px] text-muted-foreground">{goal.detail}</p> : null}
              {goal.link ? (
                <a
                  className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  href={goal.link}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="h-3 w-3" />
                  {goal.label || "Resolver no Mercado Livre"}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground">
          Os objetivos vêm do Mercado Livre e são recalculados por lá após cada alteração.
        </p>
      </PopoverContent>
    </Popover>
  );
}
