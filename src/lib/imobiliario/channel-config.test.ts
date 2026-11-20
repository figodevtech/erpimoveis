import assert from "node:assert/strict";
import { test } from "node:test";
import { channelConfigSchema } from "./channel-config";

const input = { imovel_id: 1, canal: "AIRBNB", calendario_url: "https://www.airbnb.com/calendar/ical/123.ics?s=token" };
test("aceita calendários oficiais e rejeita anúncio comum, canal trocado e destinos indevidos", () => {
  assert.equal(channelConfigSchema.safeParse(input).success, true);
  for (const host of ["www.airbnb.com.br", "airbnb.com.br"]) {
    assert.equal(channelConfigSchema.safeParse({ ...input, calendario_url: `https://${host}/calendar/ical/123.ics?t=example-token` }).success, true);
    assert.equal(channelConfigSchema.safeParse({ ...input, calendario_url: `https://${host}.evil.test/calendar/ical/123.ics` }).success, false);
  }
  assert.equal(channelConfigSchema.safeParse({ ...input, canal: "BOOKING", calendario_url: "https://ical.booking.com/v1/export?t=token" }).success, true);
  for (const calendario_url of ["invalid", "http://www.airbnb.com/calendar/ical/123.ics", "https://localhost/test.ics", "https://www.airbnb.com.evil.test/calendar/ical/123.ics", "https://user:pass@www.airbnb.com/calendar/ical/123.ics", "https://www.airbnb.com/rooms/123", "https://www.airbnb.com:8443/calendar/ical/123.ics"]) {
    assert.equal(channelConfigSchema.safeParse({ ...input, calendario_url }).success, false, calendario_url);
  }
  assert.equal(channelConfigSchema.safeParse({ ...input, canal: "BOOKING" }).success, false);
});
test("exige imóvel válido e confirmação booleana", () => {
  assert.equal(channelConfigSchema.safeParse({ ...input, imovel_id: -1 }).success, false);
  assert.equal(channelConfigSchema.safeParse({ ...input, exportacao_confirmada: "true" }).success, false);
  assert.equal(channelConfigSchema.parse(input).exportacao_confirmada, false);
});
