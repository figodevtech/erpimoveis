import type { ChatUser, ConversationSummary } from "@/lib/chat/contracts";

type DirectConversationResult = { conversation: ConversationSummary };

export async function selectDirectChatUser(
  user: ChatUser,
  actions: {
    createConversation: (userId: string) => Promise<DirectConversationResult>;
    refreshConversations: () => Promise<void>;
    showConversation: (conversation: ConversationSummary) => void;
  },
) {
  const result = await actions.createConversation(user.id);
  await actions.refreshConversations();
  actions.showConversation(result.conversation);
  return result.conversation;
}
