import type {
  ChatMessage,
  ChatMessageType,
  ChatReaction,
  ChatReactionSummary,
  ChatUser,
  ConversationSummary,
  MessagePage,
} from "@/lib/chat/contracts";
import {
  CHAT_AUDIO_BUCKET,
  CHAT_AUDIO_URL_TTL_SECONDS,
  CHAT_MESSAGE_DELETE_WINDOW_SECONDS,
  CHAT_MESSAGE_EDIT_WINDOW_SECONDS,
  CHAT_FOCUS_TTL_SECONDS,
} from "@/lib/chat/contracts";
import { decodeChatCursor, encodeChatCursor } from "@/lib/chat/cursor";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function asNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function asMessageType(value: unknown): ChatMessageType {
  return String(value ?? "TEXT") === "VOICE" ? "VOICE" : "TEXT";
}

function asReactions(value: unknown): ChatReactionSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: any) => ({
      reaction: String(item?.reacao ?? "") as ChatReaction,
      total: asNumber(item?.total),
      own: Boolean(item?.own),
    }))
    .filter((item) => item.reaction && item.total > 0);
}

/**
 * Mapeia uma linha das funcoes SQL para o contrato publico. O caminho do audio
 * nunca sai do servidor: o navegador recebe apenas metadados e usa a rota
 * autenticada para obter uma URL assinada.
 */
function mapMessageRow(row: any, conversationId: string): ChatMessage {
  const type = asMessageType(row.tipo);
  const deletedForEveryoneAt = row.excluida_para_todos_em
    ? String(row.excluida_para_todos_em)
    : null;

  return {
    id: String(row.mensagem_id),
    conversationId,
    senderId: String(row.remetente_id),
    type,
    content: deletedForEveryoneAt ? "" : String(row.conteudo ?? ""),
    clientMessageId: String(row.client_message_id),
    createdAt: String(row.created_at),
    editedAt: row.editada_em ? String(row.editada_em) : null,
    deletedForEveryoneAt,
    reply: row.reply_snapshot_tipo
      ? {
          messageId: row.reply_to_message_id ? String(row.reply_to_message_id) : null,
          type: asMessageType(row.reply_snapshot_tipo),
          content: String(row.reply_snapshot_conteudo ?? ""),
          senderName: String(row.reply_snapshot_remetente_nome ?? ""),
        }
      : null,
    audio:
      type === "VOICE" && !deletedForEveryoneAt && row.audio_mime
        ? {
            mimeType: String(row.audio_mime),
            sizeBytes: asNumber(row.audio_bytes),
            durationMs: asNumber(row.audio_duracao_ms),
          }
        : null,
    reactions: asReactions(row.reacoes),
    unread: row.nao_lida === undefined ? undefined : Boolean(row.nao_lida),
    sendStatus: "sent",
  };
}

export async function listChatUsers(userId: string, search: string): Promise<ChatUser[]> {
  const { data, error } = await supabaseAdmin
    .from("usuario")
    .select("id, nome, username, foto_url, setor:setorid(id,nome)")
    .eq("ativo", true)
    .neq("id", userId)
    .order("nome", { ascending: true });

  if (error) throw error;
  const term = normalizeSearch(search.trim());

  return (data ?? [])
    .map((row: any): ChatUser => {
      const setor = Array.isArray(row.setor) ? row.setor[0] : row.setor;
      return {
        id: String(row.id),
        nome: String(row.nome),
        username: row.username ? String(row.username) : null,
        setor: setor ? { id: Number(setor.id), nome: String(setor.nome) } : null,
        avatarUrl: row.foto_url ? String(row.foto_url) : null,
        online: false,
        lastSeenAt: null,
      };
    })
    .filter((user) => {
      if (!term) return true;
      return [user.nome, user.username, user.setor?.nome]
        .filter(Boolean)
        .some((value) => normalizeSearch(String(value)).includes(term));
    });
}

export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  const { data, error } = await supabaseAdmin.rpc("chat_list_conversations", {
    p_usuario_id: userId,
  });
  if (error) throw error;

  const rows = data ?? [];
  const participanteIds = Array.from(
    new Set(rows.map((row: any) => String(row.participante_id)).filter(Boolean)),
  );
  const fotosPorUsuario = new Map<string, string>();

  if (participanteIds.length) {
    const { data: usuarios, error: fotosError } = await supabaseAdmin
      .from("usuario")
      .select("id, foto_url")
      .in("id", participanteIds);
    if (fotosError) throw fotosError;
    for (const usuario of usuarios ?? []) {
      if (usuario.foto_url) fotosPorUsuario.set(String(usuario.id), String(usuario.foto_url));
    }
  }

  return rows.map((row: any): ConversationSummary => ({
    id: String(row.conversa_id),
    participant: {
      id: String(row.participante_id),
      nome: String(row.participante_nome),
      username: row.participante_username ? String(row.participante_username) : null,
      setor: row.participante_setor_id
        ? { id: Number(row.participante_setor_id), nome: String(row.participante_setor_nome) }
        : null,
      avatarUrl: fotosPorUsuario.get(String(row.participante_id)) ?? null,
      online: false,
      lastSeenAt: null,
    },
    lastMessage: row.ultima_mensagem_id
      ? {
          id: String(row.ultima_mensagem_id),
          content: row.ultima_mensagem_excluida ? "" : String(row.ultima_mensagem_conteudo ?? ""),
          senderId: String(row.ultima_mensagem_remetente_id),
          createdAt: String(row.ultima_mensagem_created_at),
          type: asMessageType(row.ultima_mensagem_tipo),
          deleted: Boolean(row.ultima_mensagem_excluida),
        }
      : null,
    unreadCount: asNumber(row.nao_lidas),
    lastMessageAt: row.last_message_at ? String(row.last_message_at) : null,
    lastReadMessageId: row.last_read_message_id ? String(row.last_read_message_id) : null,
  }));
}

export async function getOrCreateDirectConversation(userId: string, recipientId: string) {
  const { data, error } = await supabaseAdmin.rpc("chat_get_or_create_direct", {
    p_usuario_atual: userId,
    p_destinatario: recipientId,
  });
  if (error) throw error;

  const result = data?.[0];
  if (!result?.conversa_id) throw new Error("CHAT_CONVERSATION_CREATE_FAILED");

  const conversations = await listConversations(userId);
  const conversation = conversations.find((item) => item.id === result.conversa_id);
  if (!conversation) throw new Error("CHAT_CONVERSATION_NOT_FOUND");

  return { conversation, created: Boolean(result.criada) };
}

export async function listMessages(
  userId: string,
  conversationId: string,
  encodedCursor: string | undefined,
  limit: number,
): Promise<MessagePage> {
  const cursor = decodeChatCursor(encodedCursor);
  const { data, error } = await supabaseAdmin.rpc("chat_list_messages", {
    p_usuario_id: userId,
    p_conversa_id: conversationId,
    p_before_at: cursor?.createdAt ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: limit + 1,
  });
  if (error) throw error;

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const oldest = pageRows.at(-1) as any;
  const messages: ChatMessage[] = pageRows
    .map((row: any) => mapMessageRow(row, conversationId))
    .reverse();

  const conversations = await listConversations(userId);
  const summary = conversations.find((item) => item.id === conversationId);
  const firstUnread = messages.find((message: ChatMessage) => message.unread);

  return {
    messages,
    hasMore,
    nextCursor: hasMore && oldest
      ? encodeChatCursor({ createdAt: String(oldest.created_at), id: String(oldest.mensagem_id) })
      : null,
    unreadCount: summary?.unreadCount ?? 0,
    firstUnreadMessageId: firstUnread?.id ?? null,
  };
}

export type SendMessageInput = {
  type?: ChatMessageType;
  content?: string;
  replyToMessageId?: string | null;
  audio?: {
    path: string;
    mimeType: string;
    sizeBytes: number;
    durationMs: number;
  };
};

export async function sendMessage(
  userId: string,
  conversationId: string,
  clientMessageId: string,
  input: SendMessageInput,
) {
  const type: ChatMessageType = input.type ?? "TEXT";
  const { data, error } = await supabaseAdmin.rpc("chat_send_message", {
    p_conversa_id: conversationId,
    p_remetente_id: userId,
    p_conteudo: type === "TEXT" ? input.content ?? "" : "",
    p_client_message_id: clientMessageId,
    p_tipo: type,
    p_reply_to_message_id: input.replyToMessageId ?? null,
    p_audio_path: input.audio?.path ?? null,
    p_audio_mime: input.audio?.mimeType ?? null,
    p_audio_bytes: input.audio?.sizeBytes ?? null,
    p_audio_duracao_ms: input.audio?.durationMs ?? null,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row?.mensagem_id) throw new Error("CHAT_MESSAGE_SEND_FAILED");

  return {
    message: mapMessageRow(row, String(row.conversa_id)),
    created: Boolean(row.criada),
  };
}

export async function editMessage(userId: string, messageId: string, content: string) {
  const { data, error } = await supabaseAdmin.rpc("chat_edit_message", {
    p_usuario_id: userId,
    p_mensagem_id: messageId,
    p_conteudo: content,
    p_janela_segundos: CHAT_MESSAGE_EDIT_WINDOW_SECONDS,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row?.mensagem_id) throw new Error("CHAT_MESSAGE_NOT_FOUND");

  return {
    messageId: String(row.mensagem_id),
    conversationId: String(row.conversa_id),
    content: String(row.conteudo ?? ""),
    editedAt: row.editada_em ? String(row.editada_em) : null,
  };
}

export async function deleteMessageForMe(userId: string, messageId: string) {
  const { data, error } = await supabaseAdmin.rpc("chat_delete_message_for_me", {
    p_usuario_id: userId,
    p_mensagem_id: messageId,
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    messageId: String(row?.mensagem_id ?? messageId),
    conversationId: row?.conversa_id ? String(row.conversa_id) : null,
  };
}

/**
 * A funcao SQL enfileira o objeto em `chat_audio_pendente_remocao` e limpa o
 * caminho da mensagem. Aqui o objeto sai do Storage; a linha da fila so e
 * apagada depois da remocao confirmada, para que uma falha continue rastreada.
 */
export async function deleteMessageForEveryone(userId: string, messageId: string) {
  const { data, error } = await supabaseAdmin.rpc("chat_delete_message_for_everyone", {
    p_usuario_id: userId,
    p_mensagem_id: messageId,
    p_janela_segundos: CHAT_MESSAGE_DELETE_WINDOW_SECONDS,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row?.mensagem_id) throw new Error("CHAT_MESSAGE_NOT_FOUND");

  const audioPath = row.audio_path ? String(row.audio_path) : null;
  if (audioPath) await removePendingAudio(audioPath);

  return {
    messageId: String(row.mensagem_id),
    conversationId: String(row.conversa_id),
    deletedForEveryoneAt: row.excluida_para_todos_em ? String(row.excluida_para_todos_em) : null,
  };
}

export async function removePendingAudio(path: string) {
  const { error } = await supabaseAdmin.storage.from(CHAT_AUDIO_BUCKET).remove([path]);
  if (error) {
    // O audio ja esta inacessivel porque a mensagem perdeu o caminho. A linha
    // permanece na fila para uma limpeza posterior.
    console.error("[chat] falha ao remover audio do Storage:", error.message);
    return false;
  }
  await supabaseAdmin.from("chat_audio_pendente_remocao").delete().eq("path", path);
  return true;
}

export async function setMessageReaction(
  userId: string,
  messageId: string,
  reaction: ChatReaction,
) {
  const { data, error } = await supabaseAdmin.rpc("chat_set_reaction", {
    p_usuario_id: userId,
    p_mensagem_id: messageId,
    p_reacao: reaction,
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    messageId: String(row?.mensagem_id ?? messageId),
    conversationId: row?.conversa_id ? String(row.conversa_id) : null,
    reactions: asReactions(row?.reacoes),
  };
}

export async function clearMessageReaction(userId: string, messageId: string) {
  const { data, error } = await supabaseAdmin.rpc("chat_clear_reaction", {
    p_usuario_id: userId,
    p_mensagem_id: messageId,
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    messageId: String(row?.mensagem_id ?? messageId),
    conversationId: row?.conversa_id ? String(row.conversa_id) : null,
    reactions: asReactions(row?.reacoes),
  };
}

export async function uploadVoiceObject(path: string, file: ArrayBuffer, mimeType: string) {
  // `upsert` deixa a retentativa idempotente: o mesmo client_message_id sempre
  // aponta para o mesmo objeto, entao repetir o envio nao cria orfaos.
  const { error } = await supabaseAdmin.storage
    .from(CHAT_AUDIO_BUCKET)
    .upload(path, file, { contentType: mimeType, upsert: true });
  if (error) throw error;
}

export async function removeVoiceObject(path: string) {
  await supabaseAdmin.storage.from(CHAT_AUDIO_BUCKET).remove([path]).catch(() => undefined);
}

export async function createVoiceSignedUrl(userId: string, messageId: string) {
  const { data, error } = await supabaseAdmin.rpc("chat_audio_access", {
    p_usuario_id: userId,
    p_mensagem_id: messageId,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row?.audio_path) throw new Error("CHAT_AUDIO_UNAVAILABLE");

  const signed = await supabaseAdmin.storage
    .from(CHAT_AUDIO_BUCKET)
    .createSignedUrl(String(row.audio_path), CHAT_AUDIO_URL_TTL_SECONDS);

  if (signed.error || !signed.data?.signedUrl) {
    throw signed.error ?? new Error("CHAT_AUDIO_UNAVAILABLE");
  }

  return {
    url: signed.data.signedUrl,
    expiresAt: new Date(Date.now() + CHAT_AUDIO_URL_TTL_SECONDS * 1_000).toISOString(),
    mimeType: row.audio_mime ? String(row.audio_mime) : null,
    durationMs: asNumber(row.audio_duracao_ms),
  };
}

export async function markConversationRead(userId: string, conversationId: string, lastMessageId: string) {
  const { data, error } = await supabaseAdmin.rpc("chat_mark_read", {
    p_usuario_id: userId,
    p_conversa_id: conversationId,
    p_last_message_id: lastMessageId,
  });
  if (error) throw error;
  const row = data?.[0];

  const [conversations, unreadCount] = await Promise.all([
    listConversations(userId),
    getUnreadCount(userId),
  ]);
  return {
    lastReadMessageId: row?.last_read_message_id ? String(row.last_read_message_id) : null,
    lastReadAt: row?.last_read_at ? String(row.last_read_at) : null,
    changed: Boolean(row?.alterada),
    conversationUnreadCount: conversations.find((item) => item.id === conversationId)?.unreadCount ?? 0,
    unreadCount,
  };
}

export async function markConversationFocus(
  userId: string,
  conversationId: string,
  active: boolean,
) {
  const { error } = await supabaseAdmin.rpc("chat_marcar_foco", {
    p_usuario_id: userId,
    p_conversa_id: conversationId,
    p_segundos: active ? CHAT_FOCUS_TTL_SECONDS : 0,
  });
  if (error) throw error;
}

export async function getUnreadCount(userId: string) {
  const { data, error } = await supabaseAdmin.rpc("chat_unread_count", {
    p_usuario_id: userId,
  });
  if (error) throw error;
  return asNumber(data);
}

export type ChatPushTarget = {
  conversationId: string;
  recipientId: string;
  senderId: string;
  senderName: string;
  type: ChatMessageType;
  content: string;
  suppressed: boolean;
};

export async function getPushTarget(messageId: string): Promise<ChatPushTarget | null> {
  const { data, error } = await supabaseAdmin.rpc("chat_push_target", {
    p_mensagem_id: messageId,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row?.destinatario_id) return null;

  return {
    conversationId: String(row.conversa_id),
    recipientId: String(row.destinatario_id),
    senderId: String(row.remetente_id),
    senderName: String(row.remetente_nome ?? ""),
    type: asMessageType(row.tipo),
    content: String(row.conteudo ?? ""),
    suppressed: Boolean(row.suprimido),
  };
}
