"use client";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ChatConversation } from "./chat-conversation";
import { ChatInbox } from "./chat-inbox";
import { ChatProvider, useChat } from "./chat-provider";
import { ChatTrigger } from "./chat-trigger";
import { NewConversation } from "./new-conversation";

function ChatPanel() {
  const { open, setOpen, view } = useChat();
  return (
    <>
      <ChatTrigger />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="h-[100dvh] max-h-[100dvh] w-full gap-0 overflow-hidden p-0 sm:max-w-[430px]"
          onOpenAutoFocus={(event) => {
            if (view.type === "inbox") event.preventDefault();
          }}
        >
          <SheetTitle className="sr-only">Central de conversas</SheetTitle>
          <SheetDescription className="sr-only">
            Converse por texto com outros usuários ativos do ERP Oficina.
          </SheetDescription>
          {view.type === "inbox" ? <ChatInbox /> : null}
          {view.type === "new-conversation" ? <NewConversation /> : null}
          {view.type === "conversation" ? <ChatConversation /> : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

export function ChatCenter() {
  return (
    <ChatProvider>
      <ChatPanel />
    </ChatProvider>
  );
}

