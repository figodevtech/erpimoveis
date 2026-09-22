import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  apenasDigitosNcm,
  classificarBuscaNcm,
  formatarCodigoNcm,
  limparDescricaoNcm,
  ncmVigenteEm,
  normalizarCodigoNcm,
  normalizarTextoNcm,
  ordenarResultadoNcm,
  prefixoDeSugestaoNcm,
  rotuloNcm,
  type NcmItem,
} from "./ncm";

/** O caso real: MÓDULO VOLVO 6792, NCM 9032.89.25. */
const INJECAO: NcmItem = {
  codigo: "90328925",
  descricao: "De sistemas de injeção",
  vigenciaInicio: "2022-04-01",
  vigenciaFim: null,
  ato: "Resolução Gecex nº 926/2026",
  fonte: "Portal Único Siscomex — Nomenclatura Comum do Mercosul",
  fonteUrl: "https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json",
};

const IGNICAO: NcmItem = { ...INJECAO, codigo: "90328924", descricao: "De sistemas de ignição" };
const ABS: NcmItem = {
  ...INJECAO,
  codigo: "90328921",
  descricao: "De sistemas antibloqueantes de freio (travão) (ABS)",
};

describe("1 a 3. busca por código", () => {
  it("código completo é reconhecido como código", () => {
    const busca = classificarBuscaNcm("90328925");
    assert.equal(busca.tipo, "CODIGO");
    assert.equal(busca.codigo, "90328925");
  });

  it("código parcial também é código", () => {
    const busca = classificarBuscaNcm("903289");
    assert.equal(busca.tipo, "CODIGO");
    assert.equal(busca.codigo, "903289");
  });

  it("pontuação de nota fiscal é normalizada", () => {
    for (const digitado of ["9032.89.25", "9032 89 25", "9032-89-25"]) {
      const busca = classificarBuscaNcm(digitado);
      assert.equal(busca.tipo, "CODIGO", digitado);
      assert.equal(busca.codigo, "90328925", digitado);
    }
  });

  it("mais de 8 dígitos são cortados em 8", () => {
    assert.equal(classificarBuscaNcm("903289251234").codigo, "90328925");
  });

  it("um dígito só não dispara busca", () => {
    assert.equal(classificarBuscaNcm("9").tipo, "CURTA");
  });

  it("texto com número no meio continua sendo texto", () => {
    const busca = classificarBuscaNcm("sistema 3");
    assert.equal(busca.tipo, "TEXTO");
    assert.equal(busca.texto, "sistema 3");
  });
});

describe("4 e 5. busca por descrição", () => {
  it("acento é removido para casar com a coluna normalizada do banco", () => {
    assert.equal(normalizarTextoNcm("injeção"), "injecao");
    assert.equal(normalizarTextoNcm("IGNIÇÃO"), "ignicao");
    assert.equal(normalizarTextoNcm("Alumínio"), "aluminio");
  });

  it("busca é case-insensitive", () => {
    assert.equal(classificarBuscaNcm("INJEÇÃO").texto, "injecao");
    assert.equal(classificarBuscaNcm("Injeção").texto, "injecao");
  });

  it("trecho da descrição é aceito", () => {
    const busca = classificarBuscaNcm("controlador");
    assert.equal(busca.tipo, "TEXTO");
    assert.equal(busca.texto, "controlador");
  });

  it("uma letra só não dispara busca", () => {
    assert.equal(classificarBuscaNcm("a").tipo, "CURTA");
    assert.equal(classificarBuscaNcm("  ").tipo, "CURTA");
  });

  it("guarda também o texto como foi digitado", () => {
    // A coluna normalizada do banco quer "injecao"; a descrição crua, usada
    // enquanto a migration não é aplicada, quer "injeção".
    const busca = classificarBuscaNcm("Injeção");
    assert.equal(busca.texto, "injecao");
    assert.equal(busca.textoOriginal, "Injeção");
  });
});

describe("6 e 7. código inexistente e sugestão por prefixo", () => {
  it("o prefixo de sugestão é a subposição de 6 dígitos do SH", () => {
    // 90328920 não existe; 903289xx é a família de verdade, não semelhança
    // inventada a partir do nome do produto.
    assert.equal(prefixoDeSugestaoNcm("90328920"), "903289");
  });

  it("código incompleto não gera sugestão", () => {
    assert.equal(prefixoDeSugestaoNcm("903289"), null);
    assert.equal(prefixoDeSugestaoNcm(""), null);
  });

  it("normalizarCodigoNcm só aceita 8 dígitos", () => {
    assert.equal(normalizarCodigoNcm("9032.89.25"), "90328925");
    assert.equal(normalizarCodigoNcm("903289"), null);
    assert.equal(normalizarCodigoNcm("903289251"), null);
    assert.equal(normalizarCodigoNcm(null), null);
  });
});

describe("8 a 10. vigência", () => {
  it("NCM vigente aparece na data atual", () => {
    assert.equal(ncmVigenteEm(INJECAO, "2026-09-22"), true);
  });

  it("NCM que ainda não começou não aparece", () => {
    assert.equal(ncmVigenteEm(INJECAO, "2022-03-31"), false);
    assert.equal(ncmVigenteEm(INJECAO, "2022-04-01"), true, "o primeiro dia já vale");
  });

  it("NCM encerrado não aparece para a data de hoje", () => {
    const extinto = { ...INJECAO, vigenciaFim: "2025-12-31" };
    assert.equal(ncmVigenteEm(extinto, "2026-09-22"), false);
  });

  it("consulta histórica acha o NCM que valia naquela data", () => {
    const extinto = { ...INJECAO, vigenciaFim: "2025-12-31" };
    assert.equal(ncmVigenteEm(extinto, "2025-12-31"), true, "o último dia ainda vale");
    assert.equal(ncmVigenteEm(extinto, "2024-06-10"), true);
  });

  it("sem vigência de início o código não é escondido", () => {
    // A ausência é do dado importado, não uma afirmação de que não valia.
    const semInicio = { ...INJECAO, vigenciaInicio: null };
    assert.equal(ncmVigenteEm(semInicio, "2010-01-01"), true);
  });
});

describe("12 e 13. valor x rótulo", () => {
  it("o rótulo junta código e descrição, mas o valor é só o código", () => {
    assert.equal(rotuloNcm(INJECAO), "90328925 — De sistemas de injeção");
    assert.equal(INJECAO.codigo, "90328925");
  });

  it("sem descrição, o rótulo é o código sozinho", () => {
    assert.equal(rotuloNcm({ codigo: "90328925", descricao: "" }), "90328925");
  });

  it("descrição com HTML do portal é limpa antes de exibir", () => {
    // O Siscomex publica marcação em algumas descrições.
    const sujo = "De alimentos (UHT - <i>Ultra High Temperature</i>) por injeção";
    assert.equal(
      limparDescricaoNcm(sujo),
      "De alimentos (UHT - Ultra High Temperature ) por injeção",
    );
    assert.ok(!limparDescricaoNcm(sujo).includes("<"));
  });

  it("formata o código para leitura sem alterar o valor gravado", () => {
    assert.equal(formatarCodigoNcm("90328925"), "9032.89.25");
    assert.equal(apenasDigitosNcm("9032.89.25"), "90328925");
  });
});

describe("11. ordem e limite do resultado", () => {
  it("o código exato vem primeiro, não a ordem alfabética", () => {
    const ordenado = ordenarResultadoNcm([ABS, IGNICAO, INJECAO], "90328925");
    assert.equal(ordenado[0].codigo, "90328925");
  });

  it("sem código exato, mantém a ordem recebida", () => {
    const itens = [ABS, IGNICAO, INJECAO];
    assert.deepEqual(ordenarResultadoNcm(itens, ""), itens);
  });

  it("ordenar não altera o array original", () => {
    const itens = [ABS, IGNICAO, INJECAO];
    ordenarResultadoNcm(itens, "90328925");
    assert.equal(itens[0].codigo, "90328921");
  });
});
