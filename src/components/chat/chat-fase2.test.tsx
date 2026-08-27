import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ChatMessage } from "@/lib/chat/contracts";
import {
  CHAT_REACTIONS,
  CHAT_MESSAGE_EDIT_WINDOW_SECONDS,
  CHAT_REPLY_SNAPSHOT_MAX_LENGTH,
  chatAudioExtension,
  chatMessagePreviewLabel,
  isSupportedChatAudioMime,
  messageReactionSchema,
  voiceMessageSchema,
} from "@/lib/chat/contracts";
import { availableChatMessageActions } from "./chat-message-actions";
import { ChatMessageBubble } from "./chat-message-bubble";
import {
  applyMessageDeletedForEveryone,
  applyMessageEdit,
  applyMessageReactions,
  canDeleteChatMessageForEveryone,
  canEditChatMessage,
  chatAudioDurationLabel,
  chatReplyPreviewFrom,
  createOptimisticMessage,
  removeMessageLocally,
  shouldRevealChatMessageControls,
  toggleReactionLocally,
} from "./chat-utils";

const conversationId = "20000000-0000-4000-8000-000000000001";
const autor = "10000000-0000-4000-8000-000000000001";
const outro = "10000000-0000-4000-8000-000000000002";
const agora = new Date("2026-08-28T12:00:00.000Z").getTime();

function mensagem(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    conversationId,
    senderId: autor,
    type: "TEXT",
    content: "A peça da OS chegou?",
    clientMessageId: "40000000-0000-4000-8000-000000000001",
    createdAt: "2026-08-28T11:55:00.000Z",
    editedAt: null,
    deletedForEveryoneAt: null,
    reply: null,
    audio: null,
    reactions: [],
    sendStatus: "sent",
    ...overrides,
  };
}

const bubbleActions = {
  onReply: () => undefined,
  onReact: () => undefined,
  onEdit: () => undefined,
  onDeleteForMe: () => undefined,
  onDeleteForEveryone: () => undefined,
  onJumpToMessage: () => undefined,
};

// ----------------------------------------------------- controles contextuais

test("dropdown contem somente acoes textuais permitidas", () => {
  assert.deepEqual(
    availableChatMessageActions({ canReply: true, canEdit: true, canDeleteForEveryone: true }),
    ["reply", "edit", "delete-for-me", "delete-for-everyone"],
  );
  assert.deepEqual(
    availableChatMessageActions({ canReply: false, canEdit: false, canDeleteForEveryone: false }),
    ["delete-for-me"],
  );
  assert.equal(
    availableChatMessageActions({ canReply: true, canEdit: false, canDeleteForEveryone: false })
      .includes("reaction" as never),
    false,
  );
});

test("acao fica dentro do balao e reacao fica separada no lado interno", () => {
  const propria = renderToStaticMarkup(
    <ChatMessageBubble
      message={mensagem()}
      own
      currentUserId={autor}
      onRetry={() => undefined}
      actions={bubbleActions}
    />,
  );
  assert.match(propria, /aria-label="Ações da mensagem"/);
  assert.match(propria, /data-chat-message-action="inside-bubble"/);
  assert.match(propria, /aria-label="Adicionar reação"/);
  assert.match(propria, /data-chat-reaction-placement="before-bubble"/);
  assert.match(propria, /opacity-0/);

  const recebida = renderToStaticMarkup(
    <ChatMessageBubble
      message={mensagem({ senderId: outro })}
      own={false}
      currentUserId={autor}
      onRetry={() => undefined}
      actions={bubbleActions}
    />,
  );
  assert.match(recebida, /data-chat-reaction-placement="after-bubble"/);
});

test("balao nao muda de largura entre o tique unico e o duplo", () => {
  const renderizar = (sendStatus: "sending" | "sent") => renderToStaticMarkup(
    <ChatMessageBubble
      message={mensagem({ sendStatus })}
      own
      currentUserId={autor}
      onRetry={() => undefined}
      actions={bubbleActions}
    />,
  );

  const enviando = renderizar("sending");
  const enviada = renderizar("sent");

  // O gatilho so aparece depois de persistir, mas a faixa dele e reservada
  // desde o envio otimista: sem isso o balao alarga ao ganhar o segundo tique.
  assert.match(enviando, /data-chat-message-bubble="true"[^>]*pr-10/);
  assert.match(enviada, /data-chat-message-bubble="true"[^>]*pr-10/);
  assert.match(enviando, /aria-label="Enviando"/);
  assert.doesNotMatch(enviando, /aria-label="Ações da mensagem"/);
  assert.match(enviada, /aria-label="Enviada"/);
  assert.match(enviada, /aria-label="Ações da mensagem"/);
});

test("seletor separado permanece limitado as quatro reacoes", () => {
  assert.deepEqual(CHAT_REACTIONS, ["CORACAO", "LEGAL", "FELIZ", "TRISTE"]);
});

test("toque neutro revela controles, mas mouse, player e scroll nao", () => {
  const base = {
    pointerType: "touch",
    startMessageKey: "mensagem-1",
    endMessageKey: "mensagem-1",
    deltaX: 2,
    deltaY: 3,
    interactive: false,
  };
  assert.equal(shouldRevealChatMessageControls(base), true);
  assert.equal(shouldRevealChatMessageControls({ ...base, pointerType: "mouse" }), false);
  assert.equal(shouldRevealChatMessageControls({ ...base, interactive: true }), false);
  assert.equal(shouldRevealChatMessageControls({ ...base, deltaY: 24 }), false);
  assert.equal(shouldRevealChatMessageControls({ ...base, endMessageKey: "mensagem-2" }), false);
});

// ---------------------------------------------------------------- resposta

test("citacao guarda recorte historico do texto e limita o tamanho", () => {
  const original = mensagem({ content: "x".repeat(400) });
  const previa = chatReplyPreviewFrom(original, "João");

  assert.equal(previa.messageId, original.id);
  assert.equal(previa.senderName, "João");
  assert.equal(previa.type, "TEXT");
  assert.equal(previa.content.length, CHAT_REPLY_SNAPSHOT_MAX_LENGTH);
});

test("citacao de mensagem de voz nao carrega conteudo", () => {
  const voz = mensagem({
    type: "VOICE",
    content: "",
    audio: { mimeType: "audio/webm", sizeBytes: 1_024, durationMs: 3_000 },
  });
  assert.equal(chatReplyPreviewFrom(voz, "João").content, "");
  assert.equal(chatMessagePreviewLabel({ type: "VOICE", content: "" }), "Mensagem de voz");
});

test("balao mostra a citacao e continua valido apos o original ser excluido", () => {
  const html = renderToStaticMarkup(
    <ChatMessageBubble
      message={mensagem({
        content: "Chegou sim.",
        reply: { messageId: "outra", type: "TEXT", content: "A peça da OS chegou?", senderName: "João" },
      })}
      own
      currentUserId={autor}
      onRetry={() => undefined}
    />,
  );
  assert.match(html, /João/);
  assert.match(html, /A peça da OS chegou\?/);
  assert.match(html, /Ir para a mensagem de João/);
});

test("citacao sem conteudo aparece como mensagem excluida", () => {
  const html = renderToStaticMarkup(
    <ChatMessageBubble
      message={mensagem({
        reply: { messageId: "outra", type: "TEXT", content: "", senderName: "João" },
      })}
      own={false}
      currentUserId={outro}
      onRetry={() => undefined}
    />,
  );
  assert.match(html, /Mensagem excluída/);
});

// ---------------------------------------------------------------- reacoes

test("reacao substitui a anterior, remove ao repetir e nunca duplica", () => {
  const inicial = toggleReactionLocally([], "CORACAO");
  assert.deepEqual(inicial, [{ reaction: "CORACAO", total: 1, own: true }]);

  const trocada = toggleReactionLocally(inicial, "LEGAL");
  assert.deepEqual(trocada, [{ reaction: "LEGAL", total: 1, own: true }]);

  const removida = toggleReactionLocally(trocada, "LEGAL");
  assert.deepEqual(removida, []);
});

test("reacao de outro participante e preservada ao trocar a propria", () => {
  const atual = [
    { reaction: "CORACAO" as const, total: 2, own: true },
    { reaction: "LEGAL" as const, total: 1, own: false },
  ];
  const resultado = toggleReactionLocally(atual, "LEGAL");
  assert.deepEqual(resultado, [
    { reaction: "CORACAO", total: 1, own: false },
    { reaction: "LEGAL", total: 2, own: true },
  ]);
});

test("servidor rejeita reacao fora do conjunto permitido", () => {
  assert.equal(messageReactionSchema.safeParse({ reaction: "CORACAO" }).success, true);
  assert.equal(messageReactionSchema.safeParse({ reaction: "FOGUETE" }).success, false);
  assert.equal(messageReactionSchema.safeParse({ reaction: "coracao" }).success, false);
});

test("balao destaca a reacao do usuario atual com rotulo acessivel", () => {
  const html = renderToStaticMarkup(
    <ChatMessageBubble
      message={mensagem({ reactions: [{ reaction: "CORACAO", total: 2, own: true }] })}
      own
      currentUserId={autor}
      onRetry={() => undefined}
    />,
  );
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /coração: 2 reações, incluindo a sua/);
});

test("estado local aceita o agregado autorizado do servidor", () => {
  const lista = [mensagem()];
  const atualizada = applyMessageReactions(lista, lista[0].id, [
    { reaction: "FELIZ", total: 3, own: false },
  ]);
  assert.deepEqual(atualizada[0].reactions, [{ reaction: "FELIZ", total: 3, own: false }]);
});

// ---------------------------------------------------------------- edicao

test("somente o autor edita texto dentro do prazo", () => {
  const propria = mensagem();
  assert.equal(canEditChatMessage(propria, autor, agora), true);
  assert.equal(canEditChatMessage(propria, outro, agora), false);
});

test("voz e mensagem excluida nao podem ser editadas", () => {
  const voz = mensagem({
    type: "VOICE",
    content: "",
    audio: { mimeType: "audio/webm", sizeBytes: 1_024, durationMs: 3_000 },
  });
  const excluida = mensagem({ content: "", deletedForEveryoneAt: "2026-08-28T11:58:00.000Z" });
  assert.equal(canEditChatMessage(voz, autor, agora), false);
  assert.equal(canEditChatMessage(excluida, autor, agora), false);
});

test("edicao fora do prazo deixa de ser oferecida", () => {
  const antiga = mensagem({
    createdAt: new Date(agora - (CHAT_MESSAGE_EDIT_WINDOW_SECONDS + 60) * 1_000).toISOString(),
  });
  assert.equal(canEditChatMessage(antiga, autor, agora), false);
  assert.equal(canDeleteChatMessageForEveryone(antiga, autor, agora), false);
});

test("mensagem editada mantem created_at e ganha a marca editada", () => {
  const lista = [mensagem()];
  const editada = applyMessageEdit(lista, lista[0].id, "Chegou sim.", "2026-08-28T11:57:00.000Z");
  assert.equal(editada[0].content, "Chegou sim.");
  assert.equal(editada[0].createdAt, lista[0].createdAt);

  const html = renderToStaticMarkup(
    <ChatMessageBubble message={editada[0]} own currentUserId={autor} onRetry={() => undefined} />,
  );
  assert.match(html, /editada/);
});

// ---------------------------------------------------------------- exclusao

test("excluir para mim tira a mensagem apenas da lista local", () => {
  const lista = [mensagem(), mensagem({ id: "outra", clientMessageId: "cli-2" })];
  assert.deepEqual(removeMessageLocally(lista, lista[0].id).map((item) => item.id), ["outra"]);
});

test("excluir para todos limpa conteudo, audio, citacao e reacoes", () => {
  const lista = [
    mensagem({
      type: "VOICE",
      content: "",
      audio: { mimeType: "audio/webm", sizeBytes: 2_048, durationMs: 5_000 },
      reactions: [{ reaction: "LEGAL", total: 1, own: true }],
      reply: { messageId: "outra", type: "TEXT", content: "oi", senderName: "João" },
    }),
  ];
  const excluida = applyMessageDeletedForEveryone(lista, lista[0].id, "2026-08-28T12:00:00.000Z");

  assert.equal(excluida[0].content, "");
  assert.equal(excluida[0].audio, null);
  assert.equal(excluida[0].reply, null);
  assert.deepEqual(excluida[0].reactions, []);
  assert.equal(excluida[0].localAudioUrl, null);
});

test("balao de mensagem excluida nao oferece reproducao nem reacoes", () => {
  const html = renderToStaticMarkup(
    <ChatMessageBubble
      message={mensagem({ content: "", deletedForEveryoneAt: "2026-08-28T12:00:00.000Z" })}
      own
      currentUserId={autor}
      onRetry={() => undefined}
      actions={bubbleActions}
    />,
  );
  assert.match(html, /Mensagem excluída/);
  assert.doesNotMatch(html, /Reproduzir mensagem de voz/);
  assert.match(html, /aria-label="Ações da mensagem"/);
  assert.doesNotMatch(html, /aria-label="Adicionar reação"/);
});

// ---------------------------------------------------------------- voz

test("mensagem de voz otimista carrega metadados e previa local", () => {
  const otimista = createOptimisticMessage({
    conversationId,
    senderId: autor,
    content: "",
    clientMessageId: "40000000-0000-4000-8000-000000000002",
    type: "VOICE",
    audio: { mimeType: "audio/webm", sizeBytes: 4_096, durationMs: 7_000 },
    localAudioUrl: "blob:previa",
  });

  assert.equal(otimista.type, "VOICE");
  assert.equal(otimista.content, "");
  assert.equal(otimista.sendStatus, "sending");
  assert.equal(otimista.localAudioUrl, "blob:previa");
});

test("balao de voz apresenta player acessivel em vez de texto", () => {
  const html = renderToStaticMarkup(
    <ChatMessageBubble
      message={mensagem({
        type: "VOICE",
        content: "",
        audio: { mimeType: "audio/webm", sizeBytes: 4_096, durationMs: 65_000 },
      })}
      own={false}
      currentUserId={outro}
      onRetry={() => undefined}
    />,
  );
  assert.match(html, /Reproduzir mensagem de voz/);
  assert.match(html, /Posição da mensagem de voz/);
  assert.match(html, /1:05/);
});

test("apenas MIME de audio realmente produzido pelos navegadores e aceito", () => {
  assert.equal(isSupportedChatAudioMime("audio/webm;codecs=opus"), true);
  assert.equal(isSupportedChatAudioMime("audio/mp4"), true);
  assert.equal(isSupportedChatAudioMime("audio/ogg"), true);
  assert.equal(isSupportedChatAudioMime("application/pdf"), false);
  assert.equal(isSupportedChatAudioMime("image/png"), false);
  assert.equal(isSupportedChatAudioMime(""), false);
});

test("extensao vem do MIME conferido, nunca do nome enviado", () => {
  assert.equal(chatAudioExtension("audio/webm;codecs=opus"), "webm");
  assert.equal(chatAudioExtension("audio/ogg"), "ogg");
  assert.equal(chatAudioExtension("audio/mp4"), "m4a");
});

test("duracao acima do limite e recusada antes de tocar o Storage", () => {
  const base = {
    clientMessageId: "40000000-0000-4000-8000-000000000003",
    replyToMessageId: null,
  };
  assert.equal(voiceMessageSchema.safeParse({ ...base, durationMs: 4_000 }).success, true);
  assert.equal(voiceMessageSchema.safeParse({ ...base, durationMs: 300_001 }).success, false);
  assert.equal(voiceMessageSchema.safeParse({ ...base, durationMs: 0 }).success, false);
});

test("duracao do audio e exibida em minutos e segundos", () => {
  assert.equal(chatAudioDurationLabel(0), "0:00");
  assert.equal(chatAudioDurationLabel(9_000), "0:09");
  assert.equal(chatAudioDurationLabel(125_000), "2:05");
});
