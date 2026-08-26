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
      className="group relative size-10 shrink-0 rounded-xl transition-[background-color,color,transform,box-shadow] duration-200 hover:bg-primary/10 hover:text-primary hover:shadow-sm active:scale-[0.94] motion-reduce:transform-none sm:size-9"
      aria-label="Abrir conversas"
      onClick={onOpen}
    >
      <MessagesSquare aria-hidden="true" className="transition-transform duration-200 group-hover:-translate-y-0.5 motion-reduce:transform-none" />
      <UnreadBadge count={unreadCount} compact />
    </Button>
  );
}
