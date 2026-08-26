import { cn } from "@/lib/utils";

export function ChatPresenceIndicator({ online, className }: { online: boolean; className?: string }) {
  const label = online ? "Online" : "Offline";
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)} title={label}>
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full ring-2 ring-background", online ? "bg-emerald-500" : "bg-zinc-400")}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

