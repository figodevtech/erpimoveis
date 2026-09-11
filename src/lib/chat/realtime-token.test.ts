import assert from "node:assert/strict";
import test from "node:test";
import {
  chatRealtimeAccessToken,
  clearChatRealtimeToken,
  ensureChatRealtimeCredentials,
  setChatRealtimeTokenSource,
  storeChatRealtimeToken,
} from "./realtime-token";

const AGORA = Date.parse("2026-08-26T12:00:00.000Z");

function daquiA(minutos: number) {
  return new Date(AGORA + minutos * 60_000).toISOString();
}

function fonte(tokens: string[], falha = false) {
  let chamadas = 0;
  return {
    get chamadas() { return chamadas; },
    source: async () => {
      chamadas += 1;
      if (falha) throw new Error("rede");
      return { token: tokens[Math.min(chamadas - 1, tokens.length - 1)], expiresAt: daquiA(10) };
    },
  };
}

test("reaproveita o token em cache enquanto ele nao esta perto de expirar", async () => {
  clearChatRealtimeToken();
  const espiao = fonte(["novo"]);
  setChatRealtimeTokenSource(espiao.source);
  storeChatRealtimeToken({ token: "vigente", expiresAt: daquiA(10) });

  assert.equal(await chatRealtimeAccessToken(AGORA), "vigente");
  assert.equal(espiao.chamadas, 0);
});

test("renova com folga antes de expirar, para o token nao morrer durante o join", async () => {
  clearChatRealtimeToken();
  const espiao = fonte(["renovado"]);
  setChatRealtimeTokenSource(espiao.source);
  storeChatRealtimeToken({ token: "quase-vencido", expiresAt: daquiA(10) });

  // Faltando 30s para expirar: dentro da margem de renovacao de 60s.
  assert.equal(await chatRealtimeAccessToken(AGORA + 9.5 * 60_000), "renovado");
  assert.equal(espiao.chamadas, 1);
});

test("falha de rede devolve o ultimo token conhecido em vez de lancar", async () => {
  clearChatRealtimeToken();
  const espiao = fonte([], true);
  setChatRealtimeTokenSource(espiao.source);
  storeChatRealtimeToken({ token: "ultimo", expiresAt: daquiA(-1) });

  assert.equal(await chatRealtimeAccessToken(AGORA), "ultimo");
});

test("sem fonte e sem cache nao ha token, e limpar obriga nova busca", async () => {
  clearChatRealtimeToken();
  setChatRealtimeTokenSource(null);
  assert.equal(await chatRealtimeAccessToken(AGORA), null);

  const espiao = fonte(["primeiro", "segundo"]);
  setChatRealtimeTokenSource(espiao.source);
  assert.equal(await chatRealtimeAccessToken(AGORA), "primeiro");
  assert.equal(await chatRealtimeAccessToken(AGORA), "primeiro");

  clearChatRealtimeToken();
  assert.equal(await chatRealtimeAccessToken(AGORA), "segundo");
  assert.equal(espiao.chamadas, 2);
});

test("joins simultaneos compartilham uma unica busca de token", async () => {
  clearChatRealtimeToken();
  const espiao = fonte(["compartilhado"]);
  setChatRealtimeTokenSource(espiao.source);

  const resultados = await Promise.all([
    chatRealtimeAccessToken(AGORA),
    chatRealtimeAccessToken(AGORA),
    chatRealtimeAccessToken(AGORA),
  ]);

  assert.deepEqual(resultados, ["compartilhado", "compartilhado", "compartilhado"]);
  assert.equal(espiao.chamadas, 1);
});

test("canais diferentes compartilham a credencial explicita em cache", async () => {
  clearChatRealtimeToken();
  const espiao = fonte(["compartilhado"]);

  const [chat, notificacoes] = await Promise.all([
    ensureChatRealtimeCredentials(espiao.source, AGORA),
    ensureChatRealtimeCredentials(espiao.source, AGORA),
  ]);

  assert.equal(chat.token, "compartilhado");
  assert.equal(notificacoes.token, "compartilhado");
  assert.equal(espiao.chamadas, 1);
});
