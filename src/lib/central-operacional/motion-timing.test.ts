import assert from "node:assert/strict";
import test from "node:test";

import {
  OPERATIONAL_FLOW_TRAVEL_MS,
  OPERATIONAL_NODE_FEED_DURATION_MS,
  OPERATIONAL_NODE_IMPACT_DELAY_MS,
  OPERATIONAL_VISUAL_EVENT_DURATION_MS,
} from "./motion-timing";

test("o impacto do nó acompanha a chegada do fluxo e cabe na janela visual", () => {
  assert.ok(OPERATIONAL_FLOW_TRAVEL_MS > 900);
  assert.ok(OPERATIONAL_NODE_IMPACT_DELAY_MS < OPERATIONAL_FLOW_TRAVEL_MS);
  assert.ok(
    OPERATIONAL_VISUAL_EVENT_DURATION_MS
      >= OPERATIONAL_FLOW_TRAVEL_MS + OPERATIONAL_NODE_FEED_DURATION_MS,
  );
});
