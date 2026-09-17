"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { MercadoLivreListingQuality as ListingQuality } from "@/lib/integrations/mercadolivre-quality";

// O Mercado Livre abre o detalhe dos objetivos ao passar o mouse. O clique
// continua valendo, para quem usa toque ou teclado.
//
// Fechar demora um pouco mais que abrir porque existe um vão entre o botão e o
// cartão: sem essa folga, atravessar o vão fecha e reabre o cartão.
const OPEN_DELAY_MS = 100;
const CLOSE_DELAY_MS = 220;

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
  // Botão e cartão são acompanhados separadamente: o cartão fica num portal, então
  // sair do botão em direção a ele dispara uma saída antes da entrada.
  const hovered = useRef({ trigger: false, content: false });

  useEffect(() => () => {
    if (timeout.current) clearTimeout(timeout.current);
  }, []);

  const syncWithPointer = () => {
    if (timeout.current) clearTimeout(timeout.current);
    const next = hovered.current.trigger || hovered.current.content;
    timeout.current = setTimeout(() => setOpen(next), next ? OPEN_DELAY_MS : CLOSE_DELAY_MS);
  };

  // Só o mouse abre por aproximação: no toque, o mesmo gesto viraria toque e
  // passagem ao mesmo tempo, e o cartão abriria e fecharia sozinho.
  const hoverProps = (part: "trigger" | "content") => ({
    onPointerEnter: (event: { pointerType: string }) => {
      if (event.pointerType !== "mouse") return;
      hovered.current[part] = true;
      syncWithPointer();
    },
    onPointerLeave: (event: { pointerType: string }) => {
      if (event.pointerType !== "mouse") return;
      hovered.current[part] = false;
      syncWithPointer();
    },
  });

  // O clique manda mais que a passagem do mouse: fechar no clique não pode ser
  // desfeito pelo ponteiro que continua sobre o botão.
  const handleOpenChange = (next: boolean) => {
    if (timeout.current) clearTimeout(timeout.current);
    if (!next) hovered.current = { trigger: false, content: false };
    setOpen(next);
  };

  const score = quality?.score ?? (health != null && Number.isFinite(Number(health)) ? Number(health) * 100 : null);
  if (score == null) return null;

  const goals = quality?.goals ?? [];
  const label = `Qualidade ${Math.round(score)}%`;
  if (!goals.length) return <span className={className}>{label}</span>;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`underline decoration-dotted underline-offset-2 hover:text-foreground ${className ?? ""}`}
          {...hoverProps("trigger")}
        >
          {label} · {goals.length} {goals.length === 1 ? "objetivo" : "objetivos"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 space-y-2 p-3"
        // Abrir por aproximação não deve roubar o foco de onde a pessoa está.
        onOpenAutoFocus={(event) => event.preventDefault()}
        {...hoverProps("content")}
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
