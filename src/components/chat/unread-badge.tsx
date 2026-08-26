import * as React from "react";

import { unreadBadgeLabel } from "./chat-utils";

export function UnreadBadge({ count, compact = false }: { count: number; compact?: boolean }) {
  if (count <= 0) return null;

  return (
    <span
      aria-label={`${count} ${count === 1 ? "mensagem não lida" : "mensagens não lidas"}`}
      className={
        compact
          ? "absolute -right-1.5 -top-1.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-white shadow-sm"
          : "inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground"
      }
    >
      {unreadBadgeLabel(count)}
    </span>
  );
}
