import assert from "node:assert/strict";
import test from "node:test";

import {
  prepararPatchGarantiaNfse,
  prepararPatchesGarantiaNfe,
  serializarConfigGarantiaNfe,
  serializarConfigGarantiaNfse,
} from "./configGarantia";

test("GET de NF-e usa false quando as colunas ou linhas ainda não têm valor", () => {
  assert.deepEqual(serializarConfigGarantiaNfe(null, null), {
    incluirGarantiaVendaNFe: false,
    incluirGarantiaVendaNFCe: false,
    incluirGarantiaOsNFe: false,
    incluirGarantiaOsNFCe: false,
  });
});

test("GET mantém independência entre origem e modelo", () => {
  assert.deepEqual(
    serializarConfigGarantiaNfe(
      { incluir_garantia_venda: true, incluir_garantia_os: false },
      { incluir_garantia_venda: false, incluir_garantia_os: true },
    ),
    {
      incluirGarantiaVendaNFe: true,
      incluirGarantiaVendaNFCe: false,
      incluirGarantiaOsNFe: false,
      incluirGarantiaOsNFCe: true,
    },
  );
});

test("PUT separa os patches das linhas NFE e NFCE", () => {
  assert.deepEqual(
    prepararPatchesGarantiaNfe({
      incluirGarantiaVendaNFe: true,
      incluirGarantiaVendaNFCe: false,
      incluirGarantiaOsNFe: false,
      incluirGarantiaOsNFCe: true,
    }),
    {
      nfe: { incluir_garantia_venda: true, incluir_garantia_os: false },
      nfce: { incluir_garantia_venda: false, incluir_garantia_os: true },
    },
  );
});

test("PUT ignora valores não booleanos em vez de converter texto false para true", () => {
  assert.deepEqual(
    prepararPatchesGarantiaNfe({ incluirGarantiaVendaNFe: "false" }),
    { nfe: {}, nfce: {} },
  );
});

test("GET e PUT de NFS-e preservam false e campo omitido", () => {
  assert.deepEqual(serializarConfigGarantiaNfse({ incluir_garantia_os: false }), {
    incluirGarantiaOs: false,
  });
  assert.deepEqual(prepararPatchGarantiaNfse({ incluirGarantiaOs: true }), {
    incluir_garantia_os: true,
  });
  assert.deepEqual(prepararPatchGarantiaNfse({}), {});
});
