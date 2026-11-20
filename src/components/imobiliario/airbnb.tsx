"use client";

import { toast } from "sonner";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { airbnbReservationUrl } from "@/lib/imobiliario/airbnb";

/** Código HM… que abre a reserva no Airbnb, em nova aba. */
export function AirbnbCodeLink({ codigo, className }: { codigo: string; className?: string }) {
  return (
    <a
      href={airbnbReservationUrl(codigo)}
      target="_blank"
      rel="noopener noreferrer"
      title="Abrir a reserva no Airbnb"
      onClick={(event) => event.stopPropagation()}
      className={cn(
        "inline-flex items-center gap-0.5 font-mono text-[11px] font-semibold text-[#e0565b] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm",
        className
      )}
    >
      {codigo}
      <ArrowUpRight className="h-3 w-3" />
    </a>
  );
}

/**
 * Cancelar ou excluir reserva do Airbnb é feito no Airbnb: no lugar da ação, o aviso e o atalho
 * para abrir a reserva lá.
 */
export function avisarFeitoNoAirbnb(titulo: string, mensagem: string, codigo?: string | null) {
  toast.info(titulo, {
    description: mensagem,
    duration: 10000,
    ...(codigo
      ? { action: { label: "Abrir no Airbnb", onClick: () => window.open(airbnbReservationUrl(codigo), "_blank", "noopener,noreferrer") } }
      : {}),
  });
}
