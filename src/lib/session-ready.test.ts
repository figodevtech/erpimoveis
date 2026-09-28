import assert from "node:assert/strict";
import test from "node:test";

import { onAppResume } from "./app-resume";
import { sessionReadiness } from "./session-ready";

const sessao = (id: string) => ({ user: { id } });

test("renovacao de permissoes (loading com sessao) mantem pronto e o mesmo usuario", () => {
  assert.deepEqual(sessionReadiness("authenticated", sessao("u1")), { ready: true, userId: "u1" });
  assert.deepEqual(sessionReadiness("loading", sessao("u1")), { ready: true, userId: "u1" });
});

test("carga inicial sem sessao ainda nao esta pronta", () => {
  assert.deepEqual(sessionReadiness("loading", undefined), { ready: false, userId: null });
  assert.deepEqual(sessionReadiness("loading", null), { ready: false, userId: null });
});

test("logout desliga na hora, mesmo que o objeto antigo ainda exista", () => {
  assert.deepEqual(sessionReadiness("unauthenticated", sessao("u1")), { ready: false, userId: null });
  assert.deepEqual(sessionReadiness("unauthenticated", null), { ready: false, userId: null });
});

test("troca real de usuario devolve o novo id", () => {
  assert.equal(sessionReadiness("authenticated", sessao("u1")).userId, "u1");
  assert.equal(sessionReadiness("loading", sessao("u2")).userId, "u2");
});

test("sessao sem id nao conta como pronta", () => {
  assert.deepEqual(sessionReadiness("authenticated", { user: { id: "  " } }), { ready: false, userId: null });
  assert.deepEqual(sessionReadiness("authenticated", { user: null }), { ready: false, userId: null });
});

function ambienteDeRetorno() {
  let agora = 10_000;
  const target = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
  return {
    target,
    doc,
    now: () => agora,
    avancar: (ms: number) => { agora += ms; },
    voltar: () => {
      doc.dispatchEvent(new Event("visibilitychange"));
      target.dispatchEvent(new Event("focus"));
      target.dispatchEvent(new Event("online"));
    },
  };
}

test("voltar para a aba (visibilitychange + focus + online) gera um unico aviso", () => {
  const ambiente = ambienteDeRetorno();
  let avisos = 0;
  const parar = onAppResume(() => { avisos += 1; }, { includeOnline: true, ...ambiente });

  ambiente.voltar();
  assert.equal(avisos, 1);

  ambiente.avancar(5_000);
  ambiente.voltar();
  assert.equal(avisos, 2);

  parar();
  ambiente.avancar(5_000);
  ambiente.voltar();
  assert.equal(avisos, 2);
});

test("aba oculta nao avisa", () => {
  const ambiente = ambienteDeRetorno();
  ambiente.doc.visibilityState = "hidden";
  let avisos = 0;
  onAppResume(() => { avisos += 1; }, ambiente);

  ambiente.voltar();
  assert.equal(avisos, 0);
});

test("online so conta quando pedido", () => {
  const ambiente = ambienteDeRetorno();
  let avisos = 0;
  onAppResume(() => { avisos += 1; }, ambiente);

  ambiente.target.dispatchEvent(new Event("online"));
  assert.equal(avisos, 0);
});
