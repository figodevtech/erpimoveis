import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findSpedLayout,
  resolveSpedLayout,
  resolveSpedLayoutForVersion,
  SpedLayoutNotConfiguredError,
} from "./layout";
import { EFD_ICMS_IPI_LAYOUT_V020 } from "./layouts/v020/definitions";
import type { EfdLayout } from "./types";

describe("resolução do leiaute por vigência", () => {
  it("2026 usa o leiaute 020", () => {
    assert.equal(resolveSpedLayout("2026-01").code, "020");
    assert.equal(resolveSpedLayout("2026-12").code, "020");
  });

  it("não reaproveita o 020 em outro exercício", () => {
    assert.throws(() => resolveSpedLayout("2027-01"), SpedLayoutNotConfiguredError);
    assert.throws(() => resolveSpedLayout("2025-12"), SpedLayoutNotConfiguredError);
    assert.equal(findSpedLayout("2027-01"), null);
  });

  it("escolhe pelo primeiro dia da competência num registro com vários leiautes", () => {
    const next: EfdLayout = { ...EFD_ICMS_IPI_LAYOUT_V020, code: "021", validFrom: "2027-01-01", validUntil: "2027-12-31" };
    const registry = [EFD_ICMS_IPI_LAYOUT_V020, next];
    assert.equal(resolveSpedLayout("2026-12", registry).code, "020");
    assert.equal(resolveSpedLayout("2027-01", registry).code, "021");
  });

  it("versão histórica mantém o leiaute com que foi montada", () => {
    assert.equal(resolveSpedLayoutForVersion("2026-08", "020").code, "020");
    assert.throws(() => resolveSpedLayoutForVersion("2026-08", "019"), /montada com o leiaute 019/);
  });

  it("recusa competência mal formada", () => {
    assert.throws(() => resolveSpedLayout("2026-13"), /AAAA-MM/);
  });
});
