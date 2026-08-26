"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChat } from "./chat-provider";
import { ChatTriggerButton } from "./chat-trigger-button";

export function ChatTrigger() {
  const { setOpen, unreadCount } = useChat();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ChatTriggerButton unreadCount={unreadCount} onOpen={() => setOpen(true)} />
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>Conversas</TooltipContent>
    </Tooltip>
  );
}
