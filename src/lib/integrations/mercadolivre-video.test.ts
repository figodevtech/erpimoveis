import assert from "node:assert/strict";
import test from "node:test";
import {
  extractMercadoLivreYoutubeId,
  mercadoLivreVideoInput,
  normalizeMercadoLivreVideoId,
} from "./mercadolivre-video";

test("normaliza URLs e IDs do YouTube para o formato aceito pelo Mercado Livre", () => {
  assert.equal(normalizeMercadoLivreVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ;youtube");
  assert.equal(normalizeMercadoLivreVideoId("https://youtu.be/dQw4w9WgXcQ?t=10"), "dQw4w9WgXcQ;youtube");
  assert.equal(normalizeMercadoLivreVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ;youtube");
});

test("converte o valor armazenado em URL editável", () => {
  assert.equal(extractMercadoLivreYoutubeId("dQw4w9WgXcQ;youtube"), "dQw4w9WgXcQ");
  assert.equal(mercadoLivreVideoInput("dQw4w9WgXcQ;youtube"), "https://youtu.be/dQw4w9WgXcQ");
});

test("recusa endereço que não seja um vídeo válido do YouTube", () => {
  assert.throws(() => normalizeMercadoLivreVideoId("https://example.com/video"), /URL válida do YouTube/);
  assert.equal(normalizeMercadoLivreVideoId(""), null);
});
