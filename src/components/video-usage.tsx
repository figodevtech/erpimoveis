"use client";

type Service = { enabled: boolean; capacityBytes: number; usedBytes: number; reservedBytes: number };

export function VideoUsage({ service }: { service: Service }) {
  const total = service.usedBytes + service.reservedBytes;
  const percent = service.capacityBytes ? total / service.capacityBytes * 100 : 0;
  return <div className="text-sm space-y-1"><p>Vídeos: {(service.usedBytes / 1e9).toFixed(2)} de {(service.capacityBytes / 1e9).toFixed(0)} GB utilizados{service.reservedBytes > 0 ? ` · ${(service.reservedBytes / 1e9).toFixed(2)} GB em envio` : ""}</p>
    {service.capacityBytes > 0 && <>
      <div role="meter" aria-label="Armazenamento de vídeos utilizado" aria-valuemin={0} aria-valuemax={service.capacityBytes} aria-valuenow={Math.min(total, service.capacityBytes)} aria-valuetext={`${percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% ocupado, incluindo envios em andamento`} className="h-2.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${percent >= 100 ? "bg-destructive" : percent >= 80 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${Math.min(100, percent)}%` }} /></div>
      <div className="flex flex-wrap justify-between gap-1 text-xs text-muted-foreground"><span>{percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% ocupado, incluindo envios</span><span>{(Math.max(0, service.capacityBytes - total) / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} GB disponíveis</span></div>
    </>}
    {percent >= 80 && <p role="status" className="text-amber-700 dark:text-amber-400">{percent >= 100 ? "Armazenamento cheio." : percent >= 90 ? "90% ou mais do armazenamento ocupado." : "80% ou mais do armazenamento ocupado."} Contate o suporte para ampliar seu plano.</p>}
    {!service.enabled && <p>Novos envios não estão liberados.</p>}
  </div>;
}
