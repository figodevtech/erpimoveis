import assert from "node:assert/strict";
import test from "node:test";

import { THEMATIC_RADIO_CATALOG } from "./thematic-catalog";

test("catálogo temático possui os 19 canais desejados sem duplicação", () => {
  assert.equal(THEMATIC_RADIO_CATALOG.length, 19);
  assert.equal(new Set(THEMATIC_RADIO_CATALOG.map((channel) => channel.slug)).size, 19);

  for (const channel of THEMATIC_RADIO_CATALOG) {
    assert.ok(channel.sources.length > 0, `${channel.slug} precisa ter uma fonte`);
    assert.equal(
      new Set(channel.sources.map((source) => source.priority)).size,
      channel.sources.length,
      `${channel.slug} possui prioridades duplicadas`,
    );
    assert.equal(
      new Set(channel.sources.map((source) => source.url)).size,
      channel.sources.length,
      `${channel.slug} possui URLs duplicadas`,
    );
    for (const source of channel.sources.filter((item) => item.active !== false)) {
      assert.equal(new URL(source.url).protocol, "https:", `${channel.slug} possui fonte ativa sem HTTPS`);
    }
  }
});
