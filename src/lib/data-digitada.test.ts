import assert from "node:assert/strict";
import test from "node:test";

import {
  formatarDataDigitada,
  interpretarDataDigitada,
  mascararDataDigitada,
} from "./data-digitada";

test("poe as barras conforme os digitos entram", () => {
  assert.equal(mascararDataDigitada("2"), "2");
  assert.equal(mascararDataDigitada("21"), "21");
  assert.equal(mascararDataDigitada("219"), "21/9");
  assert.equal(mascararDataDigitada("2109"), "21/09");
  assert.equal(mascararDataDigitada("210920"), "21/09/20");
  assert.equal(mascararDataDigitada("21092026"), "21/09/2026");
});

test("ignora o que nao e digito e para no oitavo", () => {
  assert.equal(mascararDataDigitada("21/09/2026"), "21/09/2026");
  assert.equal(mascararDataDigitada("21-09-2026"), "21/09/2026");
  assert.equal(mascararDataDigitada("2109202699"), "21/09/2026");
  assert.equal(mascararDataDigitada("abc"), "");
});

test("apagar nao deixa barra solta no campo", () => {
  // O campo tinha "21/09/2" e o backspace levou o ultimo digito.
  assert.equal(mascararDataDigitada("21/09/"), "21/09");
  assert.equal(mascararDataDigitada("21/"), "21");
});

test("interpreta a data completa", () => {
  assert.equal(interpretarDataDigitada("21/09/2026"), "2026-09-21");
  assert.equal(interpretarDataDigitada("01/01/2027"), "2027-01-01");
  assert.equal(interpretarDataDigitada("29/02/2028"), "2028-02-29");
});

test("ano de dois digitos vira 20xx", () => {
  assert.equal(interpretarDataDigitada("21/09/26"), "2026-09-21");
  assert.equal(interpretarDataDigitada("05/03/99"), "2099-03-05");
});

test("recusa dia que nao existe no mes", () => {
  // Sem esta recusa, 31/02 escorregaria para 02/03 e o titulo nasceria no mes errado.
  assert.equal(interpretarDataDigitada("31/02/2026"), null);
  assert.equal(interpretarDataDigitada("29/02/2027"), null);
  assert.equal(interpretarDataDigitada("31/04/2026"), null);
});

test("recusa data incompleta ou impossivel", () => {
  assert.equal(interpretarDataDigitada(""), null);
  assert.equal(interpretarDataDigitada("21/09"), null);
  assert.equal(interpretarDataDigitada("21/09/202"), null);
  assert.equal(interpretarDataDigitada("00/09/2026"), null);
  assert.equal(interpretarDataDigitada("21/13/2026"), null);
  assert.equal(interpretarDataDigitada("21/09/0026"), null);
});

test("volta do formato da api para o campo", () => {
  assert.equal(formatarDataDigitada("2026-09-21"), "21/09/2026");
  assert.equal(formatarDataDigitada(""), "");
  assert.equal(formatarDataDigitada(undefined), "");
  assert.equal(formatarDataDigitada(null), "");
});

test("o que sai do campo volta igual para o campo", () => {
  const iso = interpretarDataDigitada("21/09/26");
  assert.equal(iso, "2026-09-21");
  assert.equal(formatarDataDigitada(iso), "21/09/2026");
});
