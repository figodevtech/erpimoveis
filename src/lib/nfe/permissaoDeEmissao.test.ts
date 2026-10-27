import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MODELO_NFCE, MODELO_NFE } from "./modeloDocumento";
import { permissaoDeEmissao, pisoDeIdentificacaoNfce } from "./permissaoDeEmissao";

describe("permissão de emissão da venda", () => {
  it("recusa NF-e para o Consumidor Final", () => {
    const permissao = permissaoDeEmissao(MODELO_NFE, { tipo: "VENDA", clienteDoSistema: true, ufEmitente: "PB" });
    assert.equal(permissao.permitido, false);
    assert.match(permissao.permitido ? "" : permissao.motivo, /emita uma NFC-e ou troque o cliente/);
  });

  it("libera NF-e para cliente cadastrado", () => {
    assert.deepEqual(
      permissaoDeEmissao(MODELO_NFE, { tipo: "VENDA", clienteDoSistema: false, ufEmitente: "PB" }),
      { permitido: true, condicao: null },
    );
  });

  it("libera NFC-e para o Consumidor Final e avisa o limite da Paraíba", () => {
    const permissao = permissaoDeEmissao(MODELO_NFCE, { tipo: "VENDA", clienteDoSistema: true, ufEmitente: "pb" });
    assert.equal(permissao.permitido, true);
    assert.match(permissao.permitido ? permissao.condicao ?? "" : "", /R\$\s500,00/);
  });

  it("não inventa limite em UF sem regra", () => {
    assert.deepEqual(
      permissaoDeEmissao(MODELO_NFCE, { tipo: "VENDA", clienteDoSistema: true, ufEmitente: "PE" }),
      { permitido: true, condicao: null },
    );
    assert.equal(pisoDeIdentificacaoNfce("PE"), null);
    assert.equal(pisoDeIdentificacaoNfce(null), null);
  });

  it("vale também para a OS", () => {
    const permissao = permissaoDeEmissao(MODELO_NFE, { tipo: "OS", clienteDoSistema: true });
    assert.match(permissao.permitido ? "" : permissao.motivo, /desta OS/);
  });
});
