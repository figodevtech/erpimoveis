import { test } from "node:test";
import assert from "node:assert/strict";
import { contactOptions, contactPayload } from "./mercadolivre-contact-options";
const option = { id: "OTHER", enabled: true, actionable: true, cap_available: 1, type: "free_text", char_limit: 20 };
test("somente motivos habilitados e com capacidade", () => {
  for (const changes of [{ enabled: false }, { actionable: false }, { cap_available: 0 }, { id: "UNKNOWN" }, { char_limit: null }]) {
    assert.deepEqual(contactOptions({ options: [{ ...option, ...changes }] }), []);
  }
  assert.deepEqual(contactOptions(null), []);
});
test("texto validado pelo limite retornado pela API", () => {
  const guide = { options: [option] };
  assert.deepEqual(contactPayload(guide, "OTHER", " Oi "), { option_id: "OTHER", text: "Oi" });
  assert.throws(() => contactPayload(guide, "OTHER", "x".repeat(21)), { statusCode: 422 });
  assert.throws(() => contactPayload(guide, "OTHER", " "), { statusCode: 422 });
  assert.throws(() => contactPayload(guide, "UNKNOWN", "Oi"), { statusCode: 422 });
});
test("template usa ID consultado no servidor e não texto do usuário", () => {
  const guide = { options: [{ ...option, id: "REQUEST_VARIANTS", type: "template", templates: [{ id: "official-template", vars: null }] }] };
  assert.deepEqual(contactPayload(guide, "REQUEST_VARIANTS", "ignorar"), { option_id: "REQUEST_VARIANTS", template_id: "official-template" });
});
test("tipo em maiúsculas, como a API devolve", () => {
  const guide = { options: [
    { ...option, type: "FREE_TEXT", char_limit: 350 },
    { ...option, id: "REQUEST_VARIANTS", type: "TEMPLATE", char_limit: null, templates: [{ id: "TEMPLATE___REQUEST_VARIANTS___1", vars: [] }] },
  ] };
  assert.deepEqual(contactOptions(guide).map(item => item.id), ["OTHER", "REQUEST_VARIANTS"]);
});
test("templates com variáveis não são oferecidos sem formulário próprio", () => {
  assert.deepEqual(contactOptions({ options: [{ ...option, id: "REQUEST_VARIANTS", type: "template", templates: [{ id: "template", vars: [{ id: "required" }] }] }] }), []);
});

const deliveryGuide = { options: [{ ...option, id: "DELIVERY_PROMISE", type: "TEMPLATE", templates: [{
  id: "official", vars: [{ id: "official___VAR___INIT", type: "NUMBER" }, { id: "official___VAR___LIMIT", type: "NUMBER" }],
}] }] };
test("promessa usa template e variáveis consultados, com horas válidas", () => {
  assert.deepEqual(contactPayload(deliveryGuide, "DELIVERY_PROMISE", "", { start: 12, end: 23 }), {
    option_id: "DELIVERY_PROMISE", template_id: "official", vars: [
      { id: "official___VAR___INIT", value: 12 }, { id: "official___VAR___LIMIT", value: 23 },
    ],
  });
});
test("promessa recusa horas vazias, invertidas, fracionárias e fora do dia", () => {
  for (const [start, end] of [[undefined, undefined], [null, null], ["12", "18"], [12, 12], [18, 12], [-1, 12], [12, 24], [12.5, 18], [NaN, 18], [0, Infinity]]) {
    assert.throws(() => contactPayload(deliveryGuide, "DELIVERY_PROMISE", "", { start, end }), { statusCode: 422 });
  }
});
test("promessa não oferece um contrato de variáveis desconhecido", () => {
  const changed = structuredClone(deliveryGuide);
  changed.options[0].templates[0].vars.push({ id: "unknown", type: "NUMBER" });
  assert.deepEqual(contactOptions(changed), []);
});
test("promessa com capacidade esgotada não pode ser enviada", () => {
  const changed = structuredClone(deliveryGuide);
  changed.options[0].cap_available = 0;
  assert.throws(() => contactPayload(changed, "DELIVERY_PROMISE", "", { start: 12, end: 18 }), { statusCode: 422 });
});
