import assert from "node:assert/strict";
import test from "node:test";
import { mercadoLivreListingHealth, mercadoLivreListingQuality } from "./mercadolivre-quality";

test("usa a nota de /performance, e não o health legado", () => {
  // Valores reais: o ERP guardava 0,74 e 0 enquanto o Mercado Livre mostrava 93 e 100.
  assert.equal(mercadoLivreListingHealth({ entity_type: "USER_PRODUCT", score: 93, level_wording: "Profesional" }, 0.74), 0.93);
  assert.equal(mercadoLivreListingHealth({ entity_type: "USER_PRODUCT", score: 100 }, 0), 1);
  assert.equal(mercadoLivreListingHealth({ score: 94.93671 }, null), 0.9493671);
});

test("sem nota calculada, usa o health legado quando ele vier", () => {
  assert.equal(mercadoLivreListingHealth(null, 0.74), 0.74);
  assert.equal(mercadoLivreListingHealth({ score: null }, "0.5"), 0.5);
});

test("sem nota e sem health, não inventa zero", () => {
  assert.equal(mercadoLivreListingHealth(null, null), null);
  assert.equal(mercadoLivreListingHealth({}, undefined), null);
  assert.equal(mercadoLivreListingHealth({ score: "" }, ""), null);
});

// Resposta real do anúncio "Monitor Câmera John Deere", que o Mercado Livre pontua com 74.
const performance = {
  entity_type: "USER_PRODUCT",
  entity_id: "MLBU5231480792",
  score: 74,
  level: "good",
  level_wording: "Profesional",
  calculated_at: "2026-09-17T18:20:10Z",
  buckets: [
    {
      key: "USER_PRODUCT",
      title: "Dados do produto",
      status: "PENDING",
      variables: [
        { key: "UP_TITLE", status: "COMPLETED", title: "Edite o título", rules: [] },
        {
          key: "UP_SHORTS",
          status: "PENDING",
          title: "Crie um vídeo para não perder vendas",
          rules: [
            {
              key: "UP_HAS_SHORTS",
              status: "PENDING",
              mode: "OPPORTUNITY",
              wordings: { title: "Os vídeos devem ter até um minuto, em formato vertical." },
            },
          ],
        },
      ],
    },
    {
      key: "MLB5250499767",
      title: "Condições de venda",
      status: "PENDING",
      variables: [
        {
          key: "UP_ME_FLEX_ITEM_OPTIN",
          status: "PENDING",
          title: "Entregue no mesmo dia com o Envios Flex",
          rules: [
            {
              key: "UP_ME_FLEX_ITEM_OPTIN",
              status: "PENDING",
              mode: "OPPORTUNITY",
              wordings: { title: "Entregue no mesmo dia com o Envios Flex", label: "Oferecer envio", link: "https://ml.com/flex" },
            },
          ],
        },
      ],
    },
  ],
};

test("lista só os objetivos pendentes, com grupo e explicação", () => {
  const quality = mercadoLivreListingQuality(performance);

  assert.equal(quality?.score, 74);
  assert.deepEqual(quality?.goals, [
    {
      key: "UP_SHORTS",
      title: "Crie um vídeo para não perder vendas",
      detail: "Os vídeos devem ter até um minuto, em formato vertical.",
      group: "Dados do produto",
      mode: "OPPORTUNITY",
      label: null,
      link: null,
    },
    {
      key: "UP_ME_FLEX_ITEM_OPTIN",
      title: "Entregue no mesmo dia com o Envios Flex",
      // O texto da regra repete o título, então não vira explicação duplicada.
      detail: null,
      group: "Condições de venda",
      mode: "OPPORTUNITY",
      label: "Oferecer envio",
      link: "https://ml.com/flex",
    },
  ]);
});

test("anúncio sem objetivo pendente e anúncio sem nota", () => {
  const completo = mercadoLivreListingQuality({ score: 100, buckets: [{ key: "x", title: "t", variables: [{ key: "a", status: "COMPLETED", title: "ok" }] }] });
  assert.equal(completo?.score, 100);
  assert.deepEqual(completo?.goals, []);
  assert.equal(mercadoLivreListingQuality(null), null);
});
