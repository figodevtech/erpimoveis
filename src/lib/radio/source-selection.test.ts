import assert from "node:assert/strict";
import test from "node:test";

import {
  selectBestRadioSource,
  thematicStatusFromSources,
  type SelectableRadioSource,
} from "./source-selection";

function source(
  id: string,
  priority: number,
  streamStatus: SelectableRadioSource["streamStatus"],
): SelectableRadioSource {
  return {
    id,
    priority,
    active: true,
    sourceUrl: `https://radio.test/${id}`,
    resolvedStreamUrl: streamStatus === "ONLINE" ? `https://cdn.radio.test/${id}` : null,
    playlistFormat: null,
    streamType: streamStatus === "ONLINE" ? "DIRECT_STREAM" : null,
    streamStatus,
    lastCheckedAt: "2026-08-16T12:00:00.000Z",
    lastOnlineAt: streamStatus === "ONLINE" ? "2026-08-16T12:00:00.000Z" : null,
    codec: streamStatus === "ONLINE" ? "AAC" : null,
    bitrate: null,
  };
}

test("canal com uma fonte online retorna a fonte principal", () => {
  const principal = source("mpb-1", 1, "ONLINE");
  assert.equal(selectBestRadioSource([principal]), principal);
  assert.equal(thematicStatusFromSources([principal]), "ONLINE");
});

test("canal usa o primeiro fallback online por prioridade", () => {
  const principal = source("forro-1", 1, "OFFLINE");
  const fallback = source("forro-2", 2, "ONLINE");
  const terceiro = source("forro-3", 3, "ONLINE");
  assert.equal(selectBestRadioSource([terceiro, fallback, principal]), fallback);
});

test("canal sem fontes online fica offline e sem stream selecionado", () => {
  const sources = [source("rock-1", 1, "OFFLINE"), source("rock-2", 2, "INVALID")];
  assert.equal(selectBestRadioSource(sources), null);
  assert.equal(thematicStatusFromSources(sources), "OFFLINE");
});

test("fonte inativa nunca participa da seleção", () => {
  const inactive = { ...source("legacy", 1, "ONLINE"), active: false };
  const fallback = source("safe", 2, "ONLINE");
  assert.equal(selectBestRadioSource([inactive, fallback]), fallback);
});
