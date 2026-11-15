import assert from "node:assert/strict";
import { test } from "node:test";
import { ownerBlockNotification, ownerBlockPeriod } from "./owner-block-notification";

const base = {
  ocupacaoId: 41, imovelId: 7, imovelTitulo: "Flat Tambaú 101", proprietarioId: 3,
  proprietarioNome: "Maria Souza", inicio: "2026-12-20", fim: "2026-12-28",
};

test("período mostra o último dia escolhido (fim exclusivo menos um) e a quantidade de dias", () => {
  assert.equal(ownerBlockPeriod("2026-12-20", "2026-12-28"), "20/12/2026 a 27/12/2026 (8 dias)");
  assert.equal(ownerBlockPeriod("2026-12-31", "2027-01-01"), "31/12/2026 (1 dia)");
  // Virada de mês em ano bissexto, sem efeito de fuso.
  assert.equal(ownerBlockPeriod("2028-02-28", "2028-03-01"), "28/02/2028 a 29/02/2028 (2 dias)");
});

test("bloqueio criado avisa quem, qual imóvel e o período, com link para a disponibilidade", () => {
  const n = ownerBlockNotification({ acao: "CRIADO", ...base });
  assert.equal(n.category, "IMOBILIARIO");
  assert.equal(n.title, "Proprietário bloqueou período para uso próprio");
  assert.equal(n.message, "Maria Souza bloqueou Flat Tambaú 101 para uso próprio: 20/12/2026 a 27/12/2026 (8 dias).");
  assert.equal(n.href, "/imoveis?abrir=7&aba=disponibilidade");
  assert.equal(n.source, "SITE_OWNER_BLOCK");
  assert.equal(n.sourceEventId, "BLOQUEIO:41:CRIADO");
  assert.deepEqual(n.metadata, { acao: "CRIADO", ocupacaoId: 41, imovelId: 7, proprietarioId: 3, inicio: "2026-12-20", fim: "2026-12-28" });
});

test("alteração mostra o período anterior e cada alteração tem a sua chave", () => {
  const event = { acao: "ALTERADO" as const, ...base, anterior: { inicio: "2026-12-10", fim: "2026-12-12" } };
  const first = ownerBlockNotification({ ...event, versao: "2026-11-15T10:00:00.000Z" });
  const second = ownerBlockNotification({ ...event, versao: "2026-11-15T11:00:00.000Z" });
  assert.equal(first.message, "Maria Souza alterou o bloqueio de uso próprio de Flat Tambaú 101 de 10/12/2026 a 11/12/2026 (2 dias) para 20/12/2026 a 27/12/2026 (8 dias).");
  assert.notEqual(first.sourceEventId, second.sourceEventId);
  // A repetição da mesma alteração (mesma versão) não duplica o aviso.
  assert.equal(first.sourceEventId, ownerBlockNotification({ ...event, versao: "2026-11-15T10:00:00.000Z" }).sourceEventId);
});

test("cancelamento avisa que o período ficou livre; nomes vazios têm texto de reserva", () => {
  const n = ownerBlockNotification({ acao: "CANCELADO", ...base, proprietarioNome: " ", imovelTitulo: "" });
  assert.equal(n.title, "Proprietário cancelou bloqueio de uso próprio");
  assert.equal(n.message, "O proprietário cancelou o bloqueio de uso próprio de Imóvel #7: 20/12/2026 a 27/12/2026 (8 dias). O período voltou a ficar livre.");
  assert.equal(n.sourceEventId, "BLOQUEIO:41:CANCELADO");
});
