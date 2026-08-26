export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { after } from "next/server";

import {
  CHAT_VOICE_MAX_BYTES,
  chatAudioExtension,
  conversationIdSchema,
  isSupportedChatAudioMime,
  voiceMessageSchema,
} from "@/lib/chat/contracts";
import { dispatchChatMessagePush } from "../../../../_lib/push";
import { removeVoiceObject, sendMessage, uploadVoiceObject } from "../../../../_lib/repository";
import {
  ChatApiError,
  chatErrorResponse,
  chatJson,
  requireActiveChatUser,
} from "../../../../_lib/route-utils";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * O caminho e deterministico a partir de conversa, remetente e
 * `client_message_id`. Uma retentativa sobrescreve o mesmo objeto e a UNIQUE
 * de idempotencia devolve a mesma mensagem: nao ha duplicacao nem orfao.
 */
function voiceObjectPath(
  conversationId: string,
  senderId: string,
  clientMessageId: string,
  mimeType: string,
) {
  return `${conversationId}/${senderId}/${clientMessageId}.${chatAudioExtension(mimeType)}`;
}

export async function POST(request: Request, { params }: RouteContext) {
  let uploadedPath: string | null = null;

  try {
    const { userId } = await requireActiveChatUser();
    const conversationId = conversationIdSchema.parse((await params).id);

    const form = await request.formData().catch(() => null);
    if (!form) throw new ChatApiError("CHAT_INVALID_PAYLOAD", 400);

    const input = voiceMessageSchema.parse({
      clientMessageId: form.get("clientMessageId"),
      durationMs: form.get("durationMs"),
      replyToMessageId: form.get("replyToMessageId") || null,
    });

    const file = form.get("audio");
    if (!(file instanceof File)) throw new ChatApiError("CHAT_INVALID_AUDIO", 400);

    // O MIME declarado pelo navegador nao basta: ele so e aceito quando esta na
    // lista permitida, e o tamanho real do buffer e conferido aqui.
    const mimeType = String(file.type || "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!isSupportedChatAudioMime(mimeType)) {
      throw new ChatApiError("CHAT_INVALID_AUDIO_TYPE", 400);
    }

    const buffer = await file.arrayBuffer();
    if (buffer.byteLength < 1) throw new ChatApiError("CHAT_INVALID_AUDIO", 400);
    if (buffer.byteLength > CHAT_VOICE_MAX_BYTES) {
      throw new ChatApiError("CHAT_AUDIO_TOO_LARGE", 413);
    }

    const path = voiceObjectPath(conversationId, userId, input.clientMessageId, mimeType);
    await uploadVoiceObject(path, buffer, mimeType);
    uploadedPath = path;

    const result = await sendMessage(userId, conversationId, input.clientMessageId, {
      type: "VOICE",
      replyToMessageId: input.replyToMessageId ?? null,
      audio: {
        path,
        mimeType,
        sizeBytes: buffer.byteLength,
        durationMs: input.durationMs,
      },
    });

    uploadedPath = null;
    if (result.created) after(() => dispatchChatMessagePush(result.message.id));

    return chatJson(result, result.created ? 201 : 200);
  } catch (error) {
    // A mensagem nao foi registrada: o objeto recem-enviado nao pode ficar.
    if (uploadedPath) await removeVoiceObject(uploadedPath);
    return chatErrorResponse("POST /api/chat/conversations/:id/messages/voice", error);
  }
}
