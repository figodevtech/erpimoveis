import assert from "node:assert/strict";
import test from "node:test";

import {
  aumentarFonteImpressao,
  diminuirFonteImpressao,
  lerEscalaFonteImpressao,
  percentualFonteImpressao,
  PRINT_DEFAULT_FONT_SCALE,
  PRINT_MAX_FONT_SCALE,
} from "@/lib/print/fontScale";

test("aumenta a fonte da impressão em passos até o limite", () => {
  assert.equal(aumentarFonteImpressao(PRINT_DEFAULT_FONT_SCALE), 1.1);
  assert.equal(aumentarFonteImpressao(1.1), PRINT_MAX_FONT_SCALE);
  assert.equal(aumentarFonteImpressao(PRINT_MAX_FONT_SCALE), PRINT_MAX_FONT_SCALE);
});

test("reduz a fonte da impressão somente até o tamanho padrão", () => {
  assert.equal(diminuirFonteImpressao(PRINT_MAX_FONT_SCALE), 1.1);
  assert.equal(diminuirFonteImpressao(1.1), PRINT_DEFAULT_FONT_SCALE);
  assert.equal(diminuirFonteImpressao(PRINT_DEFAULT_FONT_SCALE), PRINT_DEFAULT_FONT_SCALE);
});

test("exibe a escala como percentual inteiro", () => {
  assert.equal(percentualFonteImpressao(PRINT_DEFAULT_FONT_SCALE), 100);
  assert.equal(percentualFonteImpressao(PRINT_MAX_FONT_SCALE), 120);
});

test("recupera somente preferências de fonte suportadas", () => {
  assert.equal(lerEscalaFonteImpressao("1"), 1);
  assert.equal(lerEscalaFonteImpressao("1.1"), 1.1);
  assert.equal(lerEscalaFonteImpressao("1.2"), 1.2);
  assert.equal(lerEscalaFonteImpressao("1.5"), null);
  assert.equal(lerEscalaFonteImpressao("texto"), null);
  assert.equal(lerEscalaFonteImpressao(null), null);
});
