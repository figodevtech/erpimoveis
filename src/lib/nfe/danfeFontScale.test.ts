import assert from "node:assert/strict";
import test from "node:test";

import {
  aumentarFonteDanfe,
  DANFE_DEFAULT_FONT_SCALE,
  DANFE_MAX_FONT_SCALE,
  diminuirFonteDanfe,
  percentualFonteDanfe,
} from "@/lib/nfe/danfeFontScale";

test("aumenta a fonte do DANFE em passos limitados", () => {
  assert.equal(aumentarFonteDanfe(DANFE_DEFAULT_FONT_SCALE), 1.1);
  assert.equal(aumentarFonteDanfe(1.1), DANFE_MAX_FONT_SCALE);
  assert.equal(aumentarFonteDanfe(DANFE_MAX_FONT_SCALE), DANFE_MAX_FONT_SCALE);
});

test("permite voltar ao padrão sem ficar menor que ele", () => {
  assert.equal(diminuirFonteDanfe(DANFE_MAX_FONT_SCALE), 1.1);
  assert.equal(diminuirFonteDanfe(1.1), DANFE_DEFAULT_FONT_SCALE);
  assert.equal(diminuirFonteDanfe(DANFE_DEFAULT_FONT_SCALE), DANFE_DEFAULT_FONT_SCALE);
});

test("formata a escala como percentual inteiro", () => {
  assert.equal(percentualFonteDanfe(DANFE_DEFAULT_FONT_SCALE), 100);
  assert.equal(percentualFonteDanfe(DANFE_MAX_FONT_SCALE), 120);
});
