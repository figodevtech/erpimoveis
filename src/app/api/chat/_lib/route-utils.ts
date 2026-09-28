import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { loadUserAccess } from "@/app/api/_authz/user-access";
import { auth } from "@/lib/auth";

export class ChatApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message = code,
  ) {
    super(message);
  }
}

export type ChatContext = {
  userId: string;
  supabaseAccessToken: string | null;
  supabaseAccessTokenExpiresAt: number | null;
};

export async function requireActiveChatUser(): Promise<ChatContext> {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) throw new ChatApiError("UNAUTHENTICATED", 401);

  const access = await loadUserAccess({ userId });
  if (!access || !access.ativo) throw new ChatApiError("INACTIVE_USER", 403);

  return {
    userId,
    supabaseAccessToken: session.user.supabaseAccessToken ?? null,
    supabaseAccessTokenExpiresAt: session.user.supabaseAccessTokenExpiresAt ?? null,
  };
}

function postgresStatus(error: { code?: string; message?: string }) {
  const message = error.message ?? "";
  if (message.includes("CHAT_FORBIDDEN") || error.code === "42501") return 403;
  if (message.includes("INACTIVE_USER")) return 403;
  if (message.includes("CHAT_PUSH_NOT_CONFIGURED")) return 503;
  if (message.includes("CHAT_MESSAGE_NOT_FOUND")) return 404;
  if (message.includes("CHAT_AUDIO_UNAVAILABLE")) return 404;
  if (message.includes("CHAT_AUDIO_TOO_LARGE")) return 413;
  // Recusas definitivas de estado: a interface nao deve oferecer "tentar
  // novamente" para prazo vencido nem para mensagem ja excluida.
  if (
    message.includes("CHAT_RECIPIENT_UNAVAILABLE")
    || message.includes("CHAT_EDIT_WINDOW_EXPIRED")
    || message.includes("CHAT_DELETE_WINDOW_EXPIRED")
    || message.includes("CHAT_MESSAGE_NOT_EDITABLE")
    || message.includes("CHAT_MESSAGE_UNAVAILABLE")
  ) return 409;
  if (
    message.includes("CHAT_EMPTY_MESSAGE")
    || message.includes("CHAT_MESSAGE_TOO_LONG")
    || message.includes("CHAT_AUDIO_TOO_LONG")
  ) return 400;
  if (message.includes("CHAT_INVALID_")) return 400;
  return 500;
}

export function chatErrorResponse(scope: string, error: unknown) {
  if (error instanceof ChatApiError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
  }

  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const code = issue?.message?.startsWith("CHAT_") ? issue.message : "CHAT_INVALID_PAYLOAD";
    return NextResponse.json({ error: code, issues: error.flatten() }, { status: 400 });
  }

  const candidate = error as { code?: string; message?: string } | null;
  const code = candidate?.message?.match(/(CHAT_[A-Z_]+|INACTIVE_USER)/)?.[1] ?? "CHAT_INTERNAL_ERROR";
  const status = candidate ? postgresStatus(candidate) : 500;
  if (status >= 500) console.error(`[chat] ${scope}:`, error);
  return NextResponse.json({ error: code }, { status });
}

export function chatJson(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
