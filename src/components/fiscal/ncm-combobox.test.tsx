import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { NcmItem } from "@/lib/fiscal/ncm";

import {
  NcmCombobox,
  interpretarRespostaNcm,
  limparCacheNcm,
  semearCacheNcm,
} from "./ncm-combobox";

const INJECAO: NcmItem = {
  codigo: "90328925",
  descricao: "De sistemas de injeção",
  caminho:
    "Instrumentos e aparelhos para regulação ou controle, automáticos › Controladores eletrônicos do tipo utilizado em veículos automóveis",
  vigenciaInicio: "2022-04-01",
  vigenciaFim: null,
  ato: "Resolução Gecex nº 926/2026",
  fonte: "Portal Único Siscomex — Nomenclatura Comum do Mercosul",
  fonteUrl: "https://portalunico.siscomex.gov.br/",
};

const IGNICAO: NcmItem = { ...INJECAO, codigo: "90328924", descricao: "De sistemas de ignição" };

function render(elemento: React.ReactElement) {
  return renderToStaticMarkup(elemento);
}

beforeEach(() => {
  limparCacheNcm();
});

describe("13. exibição do valor selecionado", () => {
  it("mostra código e descrição quando o rótulo é conhecido", () => {
    semearCacheNcm([INJECAO]);
    const html = render(
      <NcmCombobox value="90328925" onValueChange={() => {}} />,
    );

    assert.ok(html.includes("90328925 — De sistemas de injeção"), html.slice(0, 300));
  });

  it("mostra só o código enquanto a descrição não chegou, sem apagar o valor", () => {
    const html = render(<NcmCombobox value="90328925" onValueChange={() => {}} />);

    assert.ok(html.includes("90328925"));
    assert.ok(!html.includes("Selecione o NCM"));
  });

  it("campo vazio mostra o texto de seleção", () => {
    const html = render(<NcmCombobox value="" onValueChange={() => {}} />);
    assert.ok(html.includes("Selecione o NCM"));
  });

  it("descrição com HTML do portal não vaza marcação para a tela", () => {
    semearCacheNcm([
      { ...INJECAO, codigo: "84198911", descricao: "UHT - <i>Ultra High Temperature</i>" },
    ]);
    const html = render(<NcmCombobox value="84198911" onValueChange={() => {}} />);

    assert.ok(html.includes("Ultra High Temperature"));
    assert.ok(!html.includes("<i>"), "a tag não pode chegar renderizada nem escapada");
  });
});

describe("família do NCM", () => {
  it("a descrição vem acompanhada do caminho na lista", () => {
    const estado = interpretarRespostaNcm(true, { ok: true, items: [INJECAO] });
    assert.equal(estado.tipo, "RESULTADOS");
    if (estado.tipo === "RESULTADOS") {
      assert.match(estado.itens[0].caminho ?? "", /Controladores eletrônicos/);
    }
  });

  it('um código "Outros" só faz sentido com a família junto', () => {
    // 9032.89.29 é publicado como "Outros". Sozinho não classifica nada.
    const outros: NcmItem = {
      ...INJECAO,
      codigo: "90328929",
      descricao: "Outros",
    };
    semearCacheNcm([outros]);
    const html = render(<NcmCombobox value="90328929" onValueChange={() => {}} />);

    // No tooltip, não abaixo do campo: a coluna do NCM divide a linha com CFOP
    // e unidade, e um parágrafo ali quebrava o formulário inteiro.
    assert.ok(html.includes("title="), "o campo precisa ter tooltip");
    assert.ok(html.includes("Controladores eletr"), "a família tem de estar no tooltip");
  });

  it("a família não ocupa espaço abaixo do campo", () => {
    semearCacheNcm([INJECAO]);
    const html = render(<NcmCombobox value="90328925" onValueChange={() => {}} />);

    // Só o botão pode citar a família; nenhum parágrafo solto embaixo dele.
    const depoisDoBotao = html.slice(html.indexOf("</button>"));
    assert.ok(!depoisDoBotao.includes("Controladores"), depoisDoBotao.slice(0, 200));
  });

  it("sem caminho, a tela não inventa contexto", () => {
    semearCacheNcm([{ ...INJECAO, codigo: "90328926", caminho: null }]);
    const html = render(<NcmCombobox value="90328926" onValueChange={() => {}} />);

    assert.ok(!html.includes("›"));
  });
});

describe("14. fonte e vigência", () => {
  it("fonte e vigência ficam no tooltip do campo", () => {
    semearCacheNcm([INJECAO]);
    const html = render(<NcmCombobox value="90328925" onValueChange={() => {}} />);

    assert.ok(html.includes("Portal Único Siscomex"));
    assert.ok(html.includes("Vigente desde 01/04/2022"));
  });

  it("com vigência encerrada, mostra o intervalo", () => {
    semearCacheNcm([{ ...INJECAO, vigenciaFim: "2027-03-31" }]);
    const html = render(<NcmCombobox value="90328925" onValueChange={() => {}} />);

    assert.ok(html.includes("Vigência: 01/04/2022 a 31/03/2027"));
  });

  it("sem NCM escolhido não há tooltip para mostrar", () => {
    const html = render(<NcmCombobox value="" onValueChange={() => {}} />);
    assert.ok(!html.includes("Portal Único Siscomex"));
  });
});

describe("16 e 17. estados da resposta", () => {
  it("resultados viram lista", () => {
    const estado = interpretarRespostaNcm(true, { ok: true, items: [INJECAO, IGNICAO] });
    assert.equal(estado.tipo, "RESULTADOS");
    assert.equal(estado.tipo === "RESULTADOS" ? estado.itens.length : 0, 2);
  });

  it("lista vazia é 'nenhum encontrado', não erro", () => {
    assert.equal(interpretarRespostaNcm(true, { ok: true, items: [] }).tipo, "VAZIO");
  });

  it("código inexistente traz as sugestões da subposição", () => {
    const estado = interpretarRespostaNcm(true, {
      ok: true,
      items: [],
      codigoInexistente: "90328920",
      sugestoes: [IGNICAO, INJECAO],
    });

    assert.equal(estado.tipo, "INEXISTENTE");
    if (estado.tipo === "INEXISTENTE") {
      assert.equal(estado.codigo, "90328920");
      assert.equal(estado.sugestoes.length, 2);
    }
  });

  it("falha HTTP e corpo inválido viram erro, nunca lista vazia", () => {
    assert.equal(interpretarRespostaNcm(false, null).tipo, "ERRO");
    assert.equal(interpretarRespostaNcm(false, { ok: true, items: [INJECAO] }).tipo, "ERRO");
    assert.equal(interpretarRespostaNcm(true, { ok: false }).tipo, "ERRO");
    assert.equal(interpretarRespostaNcm(true, null).tipo, "ERRO");
  });

  it("nenhuma resposta da API altera o valor já selecionado", () => {
    // O contrato: só a seleção do usuário chama onValueChange. Uma falha de
    // consulta não pode limpar o NCM que já estava no cadastro.
    let alteracoes = 0;
    semearCacheNcm([INJECAO]);
    const html = render(
      <NcmCombobox value="90328925" onValueChange={() => { alteracoes += 1; }} />,
    );

    interpretarRespostaNcm(false, null);
    assert.equal(alteracoes, 0);
    assert.ok(html.includes("90328925"));
  });
});
