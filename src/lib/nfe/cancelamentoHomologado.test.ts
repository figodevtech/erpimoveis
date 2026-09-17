import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { persistirCancelamentoHomologado } from "./cancelamentoHomologado";

function persistencia(evento: { error: unknown } | Error, marcacao: { error: unknown } | Error) {
  const chamadas: string[] = [];
  return {
    chamadas,
    registrarEvento: async () => {
      chamadas.push("evento");
      if (evento instanceof Error) throw evento;
      return evento;
    },
    marcarCancelada: async () => {
      chamadas.push("marcacao");
      if (marcacao instanceof Error) throw marcacao;
      return marcacao;
    },
  };
}

describe("cancelamento homologado pela SEFAZ", () => {
  it("preserva o evento e não marca a nota por fora quando a RPC grava", async () => {
    const deps = persistencia({ error: null }, { error: null });
    const resultado = await persistirCancelamentoHomologado("135260000000001", deps);
    assert.deepEqual(resultado, { eventoPreservado: true, aviso: null });
    assert.deepEqual(deps.chamadas, ["evento"]);
  });

  it("marca a nota como CANCELADA quando a RPC devolve erro", async () => {
    const deps = persistencia({ error: { message: "function does not exist" } }, { error: null });
    const resultado = await persistirCancelamentoHomologado("135260000000001", deps);
    assert.equal(resultado.eventoPreservado, false);
    assert.match(resultado.aviso ?? "", /function does not exist/);
    assert.deepEqual(deps.chamadas, ["evento", "marcacao"]);
  });

  it("marca a nota como CANCELADA quando a RPC lança", async () => {
    const deps = persistencia(new Error("timeout"), { error: null });
    const resultado = await persistirCancelamentoHomologado("135260000000001", deps);
    assert.match(resultado.aviso ?? "", /timeout/);
    assert.deepEqual(deps.chamadas, ["evento", "marcacao"]);
  });

  it("sem protocolo do evento, não tenta preservar e ainda marca a nota", async () => {
    const deps = persistencia({ error: null }, { error: null });
    const resultado = await persistirCancelamentoHomologado(null, deps);
    assert.equal(resultado.eventoPreservado, false);
    assert.match(resultado.aviso ?? "", /sem informar o protocolo/);
    assert.deepEqual(deps.chamadas, ["marcacao"]);
  });

  it("falha dizendo que a SEFAZ já cancelou quando nem a marcação passa", async () => {
    const deps = persistencia({ error: { message: "rpc" } }, { error: { message: "sem conexão" } });
    await assert.rejects(
      persistirCancelamentoHomologado("135260000000001", deps),
      /SEFAZ homologou o cancelamento.*sem conexão/,
    );
  });
});
