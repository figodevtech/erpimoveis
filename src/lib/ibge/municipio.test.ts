import assert from "node:assert/strict";
import test from "node:test";

import { nomeOficialMunicipioIbge, resolverNomeMunicipioIbge } from "./municipio";

test("resolve o município pela lista embutida, sem depender do IBGE", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed");
  });

  assert.equal(await resolverNomeMunicipioIbge("2507507", "PB"), "JOAO PESSOA");
  assert.equal(await nomeOficialMunicipioIbge("3550308"), "São Paulo");
});

test("código fora da lista com o IBGE fora do ar explica o problema em vez de 'fetch failed'", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed");
  });

  await assert.rejects(() => resolverNomeMunicipioIbge("2599999", "PB"), /não está na lista de municípios do sistema/);
});

test("continua recusando código de outra UF", async () => {
  await assert.rejects(() => resolverNomeMunicipioIbge("3550308", "PB"), /não pertence à UF PB/);
});
