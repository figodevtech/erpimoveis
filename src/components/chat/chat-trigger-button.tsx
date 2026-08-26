"use client";

import * as React from "react";
import { MessagesSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { UnreadBadge } from "./unread-badge";

export function ChatTriggerButton({
  unreadCount,
  onOpen,
}: {
  unreadCount: number;
  onOpen: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="relative size-10 shrink-0 sm:size-9"
      aria-label="Abrir conversas"
      onClick={onOpen}
    >
      <MessagesSquare aria-hidden="true" />
      <UnreadBadge count={unreadCount} compact />
    </Button>
  );
}
