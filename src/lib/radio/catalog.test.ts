import assert from "node:assert/strict";
import test from "node:test";
import { JOAO_PESSOA_RADIO_CATALOG } from "./catalog";

test("catalogo inicial possui as 22 radios globais com fontes estaveis e unicas", () => {
  assert.equal(JOAO_PESSOA_RADIO_CATALOG.length, 22);
  assert.equal(new Set(JOAO_PESSOA_RADIO_CATALOG.map((radio) => radio.id)).size, 22);
  assert.equal(
    new Set(JOAO_PESSOA_RADIO_CATALOG.map((radio) => radio.streamUrl ?? radio.playlistUrl)).size,
    22,
  );

  for (const radio of JOAO_PESSOA_RADIO_CATALOG) {
    assert.equal(radio.systemDefault, true);
    assert.equal(radio.sourcePage.includes("/aovivo/"), true);
    if (radio.streamUrl) {
      assert.equal(radio.playlistUrl, null);
      assert.equal(radio.playlistFormat, null);
      assert.equal(radio.streamUrl.includes("e-spo-"), false);
    } else {
      assert.equal(radio.playlistUrl?.includes("/play/playlist/"), true);
      assert.equal(radio.playlistFormat, "M3U");
    }
  }
});
