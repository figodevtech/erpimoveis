import assert from "node:assert/strict";
import test from "node:test";
import {
  escapeTelegramHtml,
  hashTelegramLinkToken,
  normalizeTelegramUsername,
  safeSecretMatches,
} from "@/lib/integrations/telegram";
import { eventMatchesPreference } from "@/lib/ordens/telegram-notification-rules";

const basePreference = {
  modo: "CRIACAO_FINALIZACAO" as const,
  notificar_criacao: true,
  status_selecionados: [] as string[],
};

test("criação e finalização inclui apenas os eventos simplificados", () => {
  assert.equal(eventMatchesPreference({ tipo: "CRIADA", status_novo: "ORCAMENTO" }, basePreference), true);
  assert.equal(eventMatchesPreference({ tipo: "STATUS_ALTERADO", status_novo: "CONCLUIDO" }, basePreference), true);
  assert.equal(eventMatchesPreference({ tipo: "STATUS_ALTERADO", status_novo: "SEM_COBRANCA" }, basePreference), true);
  assert.equal(eventMatchesPreference({ tipo: "STATUS_ALTERADO", status_novo: "CANCELADO" }, basePreference), false);
  assert.equal(eventMatchesPreference({ tipo: "STATUS_ALTERADO", status_novo: "EM_ANDAMENTO" }, basePreference), false);
});

test("modo personalizado respeita criação e status escolhidos", () => {
  const preference = {
    modo: "PERSONALIZADO" as const,
    notificar_criacao: false,
    status_selecionados: ["CANCELADO", "PAGAMENTO"],
  };
  assert.equal(eventMatchesPreference({ tipo: "CRIADA", status_novo: "ORCAMENTO" }, preference), false);
  assert.equal(eventMatchesPreference({ tipo: "STATUS_ALTERADO", status_novo: "CANCELADO" }, preference), true);
  assert.equal(eventMatchesPreference({ tipo: "STATUS_ALTERADO", status_novo: "CONCLUIDO" }, preference), false);
});

test("conteúdo HTML vindo do banco é escapado", () => {
  assert.equal(escapeTelegramHtml('<b>Cliente & "Filhos"</b>'), "&lt;b&gt;Cliente &amp; &quot;Filhos&quot;&lt;/b&gt;");
});

test("hash de vínculo é estável e não guarda o token original", () => {
  const hash = hashTelegramLinkToken("token-secreto");
  assert.equal(hash, hashTelegramLinkToken("token-secreto"));
  assert.notEqual(hash, "token-secreto");
  assert.equal(hash.length, 64);
});

test("comparação de segredo exige conteúdo e tamanho idênticos", () => {
  assert.equal(safeSecretMatches("segredo", "segredo"), true);
  assert.equal(safeSecretMatches("segredo-x", "segredo"), false);
  assert.equal(safeSecretMatches(null, "segredo"), false);
});

test("usuário do Telegram é normalizado e validado", () => {
  assert.equal(normalizeTelegramUsername("  @Lucas_Figo  "), "lucas_figo");
  assert.equal(normalizeTelegramUsername("nome inválido"), null);
  assert.equal(normalizeTelegramUsername("12345"), null);
  assert.equal(normalizeTelegramUsername("abc"), null);
});
