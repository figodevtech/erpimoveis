"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import type { ChatView } from "./chat-provider";

function viewKey(view: ChatView) {
  return view.type === "conversation" ? `${view.type}:${view.conversationId}` : view.type;
}

export function ChatViewTransition({
  view,
  children,
}: {
  view: ChatView;
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const direction = view.type === "inbox" ? -1 : 1;

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <AnimatePresence initial={false} mode="wait" custom={direction}>
        <motion.div
          key={viewKey(view)}
          custom={direction}
          variants={{
            initial: (value: number) => ({ opacity: 0, x: reduceMotion ? 0 : value * 16 }),
            active: { opacity: 1, x: 0 },
            exit: (value: number) => ({ opacity: 0, x: reduceMotion ? 0 : value * -12 }),
          }}
          initial="initial"
          animate="active"
          exit="exit"
          transition={{ duration: reduceMotion ? 0.08 : 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-0 flex min-h-0 flex-col"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
