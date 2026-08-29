import { z } from "zod";

const cursorSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
});

export type ChatCursor = z.infer<typeof cursorSchema>;

export function encodeChatCursor(cursor: ChatCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeChatCursor(value: string | undefined): ChatCursor | null {
  if (!value) return null;

  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch {
    throw new Error("CHAT_INVALID_CURSOR");
  }
}

