import type { ChatMessage, ChatUser, ConversationSummary, MessagePage } from "@/lib/chat/contracts";
import { decodeChatCursor, encodeChatCursor } from "@/lib/chat/cursor";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function asNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export async function listChatUsers(userId: string, search: string): Promise<ChatUser[]> {
  const { data, error } = await supabaseAdmin
    .from("usuario")
    .select("id, nome, username, setor:setorid(id,nome)")
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
        avatarUrl: null,
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

  return (data ?? []).map((row: any): ConversationSummary => ({
    id: String(row.conversa_id),
    participant: {
      id: String(row.participante_id),
      nome: String(row.participante_nome),
      username: row.participante_username ? String(row.participante_username) : null,
      setor: row.participante_setor_id
        ? { id: Number(row.participante_setor_id), nome: String(row.participante_setor_nome) }
        : null,
      avatarUrl: null,
      online: false,
      lastSeenAt: null,
    },
    lastMessage: row.ultima_mensagem_id
      ? {
          id: String(row.ultima_mensagem_id),
          content: String(row.ultima_mensagem_conteudo),
          senderId: String(row.ultima_mensagem_remetente_id),
          createdAt: String(row.ultima_mensagem_created_at),
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
    .map((row: any): ChatMessage => ({
      id: String(row.mensagem_id),
      conversationId,
      senderId: String(row.remetente_id),
      content: String(row.conteudo),
      clientMessageId: String(row.client_message_id),
      createdAt: String(row.created_at),
      unread: Boolean(row.nao_lida),
      sendStatus: "sent",
    }))
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

export async function sendMessage(
  userId: string,
  conversationId: string,
  content: string,
  clientMessageId: string,
) {
  const { data, error } = await supabaseAdmin.rpc("chat_send_message", {
    p_conversa_id: conversationId,
    p_remetente_id: userId,
    p_conteudo: content,
    p_client_message_id: clientMessageId,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row?.mensagem_id) throw new Error("CHAT_MESSAGE_SEND_FAILED");

  const message: ChatMessage = {
    id: String(row.mensagem_id),
    conversationId: String(row.conversa_id),
    senderId: String(row.remetente_id),
    content: String(row.conteudo),
    clientMessageId: String(row.client_message_id),
    createdAt: String(row.created_at),
    sendStatus: "sent",
  };
  return { message, created: Boolean(row.criada) };
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

export async function getUnreadCount(userId: string) {
  const { data, error } = await supabaseAdmin.rpc("chat_unread_count", {
    p_usuario_id: userId,
  });
  if (error) throw error;
  return asNumber(data);
}
