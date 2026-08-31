import assert from "node:assert/strict";
import test from "node:test";
import { buildMercadoLivreMe1TrackingEvent, getMercadoLivreMe1ServiceId } from "./mercadolivre-me1";

test("usa o service_id oficial do Brasil", () => {
  assert.equal(getMercadoLivreMe1ServiceId("MLB"), 11);
});

test("monta o payload V2 com rastreio completo e substatus nulo", () => {
  assert.deepEqual(
    buildMercadoLivreMe1TrackingEvent({
      siteId: "MLB",
      carrierLabel: "Correios",
      date: "2026-08-31T12:00:00-03:00",
      trackingNumber: "AA123456789BR",
      trackingUrl: "https://rastreamento.correios.com.br/app/index.php?objeto=AA123456789BR",
      status: "shipped",
      substatus: null,
    }),
    {
      payload: {
        service_id: 11,
        comment: "Enviado por Correios",
        date: "2026-08-31T15:00:00.000Z",
      },
      tracking_number: "AA123456789BR",
      tracking_url: "https://rastreamento.correios.com.br/app/index.php?objeto=AA123456789BR",
      status: "shipped",
      substatus: null,
    },
  );
});

test("recusa código sem URL porque a API V2 exige o par", () => {
  assert.throws(
    () =>
      buildMercadoLivreMe1TrackingEvent({
        siteId: "MLB",
        carrierLabel: "Transportadora",
        date: new Date().toISOString(),
        trackingNumber: "ABC123",
        status: "shipped",
      }),
    /devem ser informados juntos/,
  );
});
