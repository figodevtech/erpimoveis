"use client";

import * as React from "react";
import {
  ChevronDown,
  EyeOff,
  Pencil,
  Reply,
  SmilePlus,
  Trash2,
} from "lucide-react";

import type { ChatReaction, ChatReactionSummary } from "@/lib/chat/contracts";
import { CHAT_REACTIONS, CHAT_REACTION_LABELS } from "@/lib/chat/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type ChatMessageActionKey =
  | "reply"
  | "edit"
  | "delete-for-me"
  | "delete-for-everyone";

/** Ordem e disponibilidade do dropdown, sem misturar o seletor de reações. */
export function availableChatMessageActions({
  canReply,
  canEdit,
  canDeleteForEveryone,
}: {
  canReply: boolean;
  canEdit: boolean;
  canDeleteForEveryone: boolean;
}): ChatMessageActionKey[] {
  return [
    ...(canReply ? ["reply" as const] : []),
    ...(canEdit ? ["edit" as const] : []),
    "delete-for-me",
    ...(canDeleteForEveryone ? ["delete-for-everyone" as const] : []),
  ];
}

export type ChatMessageActionsProps = {
  own: boolean;
  open: boolean;
  selected: boolean;
  canReply: boolean;
  canEdit: boolean;
  canDeleteForEveryone: boolean;
  onOpenChange: (open: boolean) => void;
  onReply: () => void;
  onEdit: () => void;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
};

/** Dropdown textual cujo gatilho vive dentro do canto superior do balão. */
export function ChatMessageActions({
  own,
  open,
  selected,
  canReply,
  canEdit,
  canDeleteForEveryone,
  onOpenChange,
  onReply,
  onEdit,
  onDeleteForMe,
  onDeleteForEveryone,
}: ChatMessageActionsProps) {
  const [confirmarExclusao, setConfirmarExclusao] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const actions = availableChatMessageActions({ canReply, canEdit, canDeleteForEveryone });
  const hasContextualActions = canReply || canEdit;

  const confirmarOpenChange = (nextOpen: boolean) => {
    setConfirmarExclusao(nextOpen);
    if (!nextOpen) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            aria-label="Ações da mensagem"
            data-chat-message-control="true"
            data-chat-message-action="inside-bubble"
            className={cn(
              "absolute right-1.5 top-1.5 z-10 flex size-7 shrink-0 translate-y-0.5 scale-95 items-center justify-center rounded-full opacity-0 shadow-xs backdrop-blur-sm transition-[opacity,transform,background-color,color,box-shadow] duration-150",
              "pointer-events-none focus-visible:pointer-events-auto focus-visible:translate-y-0 focus-visible:scale-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
              "group-hover/message:pointer-events-auto group-hover/message:translate-y-0 group-hover/message:scale-100 group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:translate-y-0 group-focus-within/message:scale-100 group-focus-within/message:opacity-100",
              "data-[state=open]:pointer-events-auto data-[state=open]:translate-y-0 data-[state=open]:scale-100 data-[state=open]:opacity-100 motion-reduce:transform-none motion-reduce:transition-none",
              own
                ? "bg-primary-foreground/15 text-primary-foreground/80 hover:bg-primary-foreground/25 hover:text-primary-foreground data-[state=open]:bg-primary-foreground/25 data-[state=open]:text-primary-foreground"
                : "bg-card/90 text-muted-foreground ring-1 ring-border/45 hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground",
              selected && "pointer-events-auto translate-y-0 scale-100 opacity-100",
            )}
          >
            <ChevronDown aria-hidden="true" className="size-4" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align={own ? "end" : "start"}
          sideOffset={5}
          collisionPadding={10}
          className="w-52 rounded-xl border-border/70 p-1.5 shadow-xl shadow-black/10"
        >
          {actions.map((action, index) => {
            if (action === "reply") {
              return (
                <DropdownMenuItem key={action} className="h-8 rounded-lg text-xs" onSelect={onReply}>
                  <Reply aria-hidden="true" /> Responder
                </DropdownMenuItem>
              );
            }

            if (action === "edit") {
              return (
                <DropdownMenuItem key={action} className="h-8 rounded-lg text-xs" onSelect={onEdit}>
                  <Pencil aria-hidden="true" /> Editar
                </DropdownMenuItem>
              );
            }

            if (action === "delete-for-me") {
              return (
                <React.Fragment key={action}>
                  {hasContextualActions && index > 0 ? <DropdownMenuSeparator className="my-1.5" /> : null}
                  <DropdownMenuItem className="h-8 rounded-lg text-xs" onSelect={onDeleteForMe}>
                    <EyeOff aria-hidden="true" /> Excluir para mim
                  </DropdownMenuItem>
                </React.Fragment>
              );
            }

            return (
              <DropdownMenuItem
                key={action}
                variant="destructive"
                className="h-8 rounded-lg text-xs"
                onSelect={(event) => {
                  event.preventDefault();
                  setConfirmarExclusao(true);
                }}
              >
                <Trash2 aria-hidden="true" /> Excluir para todos
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmarExclusao} onOpenChange={confirmarOpenChange}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] gap-5 rounded-2xl border-border/70 p-5 sm:max-w-md">
          <AlertDialogHeader className="text-left">
            <div className="mb-1 flex size-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <Trash2 aria-hidden="true" className="size-5" />
            </div>
            <AlertDialogTitle>Excluir para todos?</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              A mensagem será substituída por “Mensagem excluída” para os dois participantes.
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/40"
              onClick={() => {
                setConfirmarExclusao(false);
                onDeleteForEveryone();
              }}
            >
              Excluir para todos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function ChatMessageReactionPicker({
  reactions,
  own,
  open,
  selected,
  onOpenChange,
  onReact,
}: {
  reactions: ChatReactionSummary[];
  own: boolean;
  open: boolean;
  selected: boolean;
  onOpenChange: (open: boolean) => void;
  onReact: (reaction: ChatReaction) => void;
}) {
  const reacaoAtual = reactions.find((item) => item.own)?.reaction ?? null;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Adicionar reação"
          data-chat-message-control="true"
          data-chat-reaction-placement={own ? "before-bubble" : "after-bubble"}
          className={cn(
            "absolute top-1/2 z-10 flex size-8 -translate-y-1/2 scale-90 items-center justify-center rounded-full border border-border/70 bg-background/90 text-muted-foreground opacity-0 shadow-sm backdrop-blur-sm transition-[opacity,transform,background-color,color,border-color] duration-150",
            "pointer-events-none focus-visible:pointer-events-auto focus-visible:scale-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
            "group-hover/message:pointer-events-auto group-hover/message:scale-100 group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:scale-100 group-focus-within/message:opacity-100",
            "data-[state=open]:pointer-events-auto data-[state=open]:scale-100 data-[state=open]:border-primary/30 data-[state=open]:bg-accent data-[state=open]:text-primary data-[state=open]:opacity-100 motion-reduce:transform-none motion-reduce:transition-none",
            own ? "right-full mr-1.5 origin-right" : "left-full ml-1.5 origin-left",
            reacaoAtual && "border-primary/25 text-primary",
            selected && "pointer-events-auto scale-100 opacity-100",
          )}
        >
          <SmilePlus aria-hidden="true" className="size-4" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align={own ? "end" : "start"}
        sideOffset={7}
        collisionPadding={10}
        className="w-auto rounded-full border-border/70 p-1.5 shadow-xl shadow-black/10"
        aria-label="Escolher reação"
      >
        <div className="flex items-center gap-0.5" role="group" aria-label="Reagir à mensagem">
          {CHAT_REACTIONS.map((reaction) => {
            const label = CHAT_REACTION_LABELS[reaction];
            const selecionada = reacaoAtual === reaction;
            return (
              <button
                key={reaction}
                type="button"
                onClick={() => {
                  onReact(reaction);
                  onOpenChange(false);
                }}
                aria-label={`Reagir com ${label.nome}`}
                aria-pressed={selecionada}
                className={cn(
                  "flex size-9 items-center justify-center rounded-full text-lg transition-[transform,background-color,box-shadow] duration-150 hover:-translate-y-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 motion-reduce:transform-none",
                  selecionada && "bg-primary/15 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_35%,transparent)]",
                )}
              >
                <span aria-hidden="true">{label.emoji}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
