import assert from "node:assert/strict";
import test from "node:test";

import {
  DESTAQUE_ESTILOS,
  DESTAQUE_TEXTO_MAX,
  estiloDestaque,
  normalizarRegrasDestaque,
} from "./destaque";

test("aceita uma regra completa e normaliza o texto", () => {
  assert.deepEqual(
    normalizarRegrasDestaque({
      PAGAMENTO: { cor: "verde", texto: "  Aguardando o cliente pagar  " },
    }),
    { PAGAMENTO: { cor: "verde", texto: "Aguardando o cliente pagar" } },
  );
});

test("texto vazio ou ausente vira null, porque o texto e opcional", () => {
  assert.deepEqual(normalizarRegrasDestaque({ EM_ANDAMENTO: { cor: "azul" } }), {
    EM_ANDAMENTO: { cor: "azul", texto: null },
  });
  assert.deepEqual(normalizarRegrasDestaque({ EM_ANDAMENTO: { cor: "azul", texto: "   " } }), {
    EM_ANDAMENTO: { cor: "azul", texto: null },
  });
});

test("corta o texto no limite em vez de recusar a regra inteira", () => {
  const regras = normalizarRegrasDestaque({
    CONCLUIDO: { cor: "cinza", texto: "x".repeat(DESTAQUE_TEXTO_MAX + 50) },
  });
  assert.equal(regras.CONCLUIDO?.texto?.length, DESTAQUE_TEXTO_MAX);
});

test("descarta status desconhecido e cor fora da paleta, mantendo o resto", () => {
  assert.deepEqual(
    normalizarRegrasDestaque({
      PAGAMENTO: { cor: "verde", texto: null },
      STATUS_QUE_NAO_EXISTE: { cor: "verde", texto: null },
      CANCELADO: { cor: "turquesa", texto: null },
      CONCLUIDO: "verde",
      SEM_COBRANCA: null,
    }),
    { PAGAMENTO: { cor: "verde", texto: null } },
  );
});

test("normaliza a chave do status para maiuscula", () => {
  assert.deepEqual(normalizarRegrasDestaque({ " pagamento ": { cor: "rosa" } }), {
    PAGAMENTO: { cor: "rosa", texto: null },
  });
});

test("valor que nao e objeto vira config vazia em vez de explodir", () => {
  assert.deepEqual(normalizarRegrasDestaque(null), {});
  assert.deepEqual(normalizarRegrasDestaque(undefined), {});
  assert.deepEqual(normalizarRegrasDestaque("verde"), {});
  assert.deepEqual(normalizarRegrasDestaque([{ cor: "verde" }]), {});
});

test("cor invalida cai no vermelho, que era o fallback do destaque manual", () => {
  assert.equal(estiloDestaque("amarelo"), DESTAQUE_ESTILOS.amarelo);
  assert.equal(estiloDestaque(null), DESTAQUE_ESTILOS.vermelho);
  assert.equal(estiloDestaque("turquesa"), DESTAQUE_ESTILOS.vermelho);
});
