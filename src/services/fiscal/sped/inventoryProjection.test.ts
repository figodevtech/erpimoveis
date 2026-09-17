import assert from "node:assert/strict";
import test from "node:test";

import { projectSpedInventory } from "./inventoryProjection";

test("inventário aplicável exige fechamento aprovado selecionado", () => {
  const result = projectSpedInventory({ applicable: true, inventory: null, items: [], competenceEnd: "2026-08-31" });
  assert.ok(result.diagnostics.some((item) => item.code === "INVENTARIO_APROVADO_AUSENTE"));
  assert.equal(result.records.length, 0);
});

test("projeta H005/H010/H020 somente a partir do fechamento explícito", () => {
  const result = projectSpedInventory({
    applicable: true,
    competenceEnd: "2026-08-31",
    inventory: { id: 1, data_inventario: "2026-08-31", motivo: "01", status: "APROVADO" },
    items: [{
      id: 2,
      codigo_item: "ITEM-1",
      unidade: "UN",
      quantidade: 2,
      valor_unitario: 10,
      valor_total: 20,
      indicador_propriedade: "PROPRIO",
      cst_icms: "000",
      base_icms: 20,
      valor_icms: 3.6,
      payload: { descricao: "Produto", ncm: "87089990" },
      config: { tipo_item: "00" },
    }],
  });
  assert.deepEqual(result.records.map((record) => record.code), ["H005", "H010", "H020"]);
  assert.ok(result.catalogRecords.some((record) => record.code === "0200"));
  assert.equal(result.diagnostics.length, 0);
});
