// O padrão fiscal de cada modelo de NFS-e: a política resolve o modelo e o
// padrão juntos, e gravar um modelo na configuração não apaga os outros.

import "./__testEnv";

import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";

import { BancoFalso } from "./__bancoFalso";
import { GET as lerConfigNfse, PUT as salvarConfigNfse } from "@/app/api/config/nfse/route";
import { resolverContextoEmissaoNFSe } from "@/lib/services/fiscais/nfse-politica";
import { mesclarPadroesEmissaoNfse } from "@/lib/fiscal/padroesEmissaoNfse";

const DEMIR = { id: 1, codigomunicipio: "2507507", regimetributario: "3", ambiente: "PRODUCAO", uf: "PB" };
const HOJE = "2026-10-02";

/** Padrão municipal de João Pessoa. */
const PADRAO_JOAO_PESSOA = {
  issRetido: "false",
  codigoCnae: "452000100",
  aliquotaIss: "5",
  itemListaServico: "14.01",
  naturezaOperacao: "1",
};

/**
 * Fixture de teste do prompt de correção — NÃO é a classificação da Demir. O
 * ERP não tem esses valores no código; quem cadastra é a empresa.
 */
const PADRAO_NACIONAL = {
  codigoTributacaoNacionalIss: "140101",
  codigoNbs: "120013110",
  tributacaoIss: "1",
  tipoRetencaoIss: "1",
  finalidadeEmissao: "0",
  consumidorFinal: "0",
  indicadorDestinatario: "0",
  codigoIndicadorOperacao: "050101",
  ibsCbsSituacaoTributaria: "000",
  ibsCbsClassificacaoTributaria: "000001",
};

const contexto = (itens: string[], padroesEmissao: unknown) =>
  resolverContextoEmissaoNFSe({ empresa: DEMIR, itensListaServico: itens, dataCompetencia: HOJE, padroesEmissao });

describe("contexto de emissão: modelo e padrão vêm juntos", () => {
  it("Teste 1: Demir após 01/10 carrega o padrão Nacional", () => {
    const resultado = contexto(["14.01"], { MUNICIPAL_JOAO_PESSOA: PADRAO_JOAO_PESSOA, NACIONAL: PADRAO_NACIONAL });
    assert.equal(resultado?.modeloEmissao, "NACIONAL");
    assert.deepEqual(resultado?.padraoFiscal, PADRAO_NACIONAL);
    assert.equal(resultado?.padraoAusente, false);
  });

  it("Teste 2: sem padrão Nacional o padrão vem null e o municipal não é usado", () => {
    const resultado = contexto(["14.01"], { MUNICIPAL_JOAO_PESSOA: PADRAO_JOAO_PESSOA });
    assert.equal(resultado?.modeloEmissao, "NACIONAL");
    assert.equal(resultado?.padraoFiscal, null);
    assert.equal(resultado?.padraoAusente, true);
  });

  it("padrão Nacional gravado vazio conta como ausente", () => {
    assert.equal(contexto(["14.01"], { NACIONAL: {} })?.padraoAusente, true);
    assert.equal(contexto(["14.01"], { NACIONAL: { codigoNbs: "  " } })?.padraoAusente, true);
  });

  it("Teste 3: exceção 01.03 carrega o padrão municipal", () => {
    const resultado = contexto(["01.03"], { MUNICIPAL_JOAO_PESSOA: PADRAO_JOAO_PESSOA, NACIONAL: PADRAO_NACIONAL });
    assert.equal(resultado?.modeloEmissao, "MUNICIPAL_JOAO_PESSOA");
    assert.deepEqual(resultado?.padraoFiscal, PADRAO_JOAO_PESSOA);
  });

  it("serviço sem item no cadastro decide pelo item do padrão municipal", () => {
    const padroes = { MUNICIPAL_JOAO_PESSOA: { ...PADRAO_JOAO_PESSOA, itemListaServico: "16.01" } };
    assert.equal(contexto([""], padroes)?.modeloEmissao, "MUNICIPAL_JOAO_PESSOA");
    assert.equal(contexto([""], { MUNICIPAL_JOAO_PESSOA: PADRAO_JOAO_PESSOA })?.modeloEmissao, "NACIONAL");
  });
});

describe("salvar padrões não apaga os outros modelos", () => {
  it("Teste 6: salvar só o Nacional preserva o municipal", () => {
    const resultado = mesclarPadroesEmissaoNfse({ MUNICIPAL_JOAO_PESSOA: PADRAO_JOAO_PESSOA }, { NACIONAL: PADRAO_NACIONAL });
    assert.deepEqual(resultado.MUNICIPAL_JOAO_PESSOA, PADRAO_JOAO_PESSOA);
    assert.deepEqual(resultado.NACIONAL, PADRAO_NACIONAL);
  });

  it("e vice-versa", () => {
    const resultado = mesclarPadroesEmissaoNfse(
      { NACIONAL: PADRAO_NACIONAL },
      { MUNICIPAL_JOAO_PESSOA: { ...PADRAO_JOAO_PESSOA, aliquotaIss: "3" } },
    );
    assert.deepEqual(resultado.NACIONAL, PADRAO_NACIONAL);
    assert.equal((resultado.MUNICIPAL_JOAO_PESSOA as Record<string, string>).aliquotaIss, "3");
  });

  it("modelo enviado vazio é a forma de limpar só ele", () => {
    const resultado = mesclarPadroesEmissaoNfse(
      { NACIONAL: PADRAO_NACIONAL, MUNICIPAL_JOAO_PESSOA: PADRAO_JOAO_PESSOA },
      { NACIONAL: {} },
    );
    assert.equal("NACIONAL" in resultado, false);
    assert.deepEqual(resultado.MUNICIPAL_JOAO_PESSOA, PADRAO_JOAO_PESSOA);
  });

  it("Cabedelo também convive", () => {
    const resultado = mesclarPadroesEmissaoNfse(
      { MUNICIPAL_CABEDELO: { itemListaServico: "14.01" }, MUNICIPAL_JOAO_PESSOA: PADRAO_JOAO_PESSOA },
      { NACIONAL: PADRAO_NACIONAL },
    );
    assert.deepEqual(Object.keys(resultado).sort(), ["MUNICIPAL_CABEDELO", "MUNICIPAL_JOAO_PESSOA", "NACIONAL"]);
  });
});

// ---------------------------------------------------------------------------
// Rotas, contra o banco em memória
// ---------------------------------------------------------------------------

function bancoDemir(padroesEmissao: Record<string, unknown>, empresa: Record<string, unknown> = {}) {
  return new BancoFalso(
    {
      empresa: [{ ...DEMIR, cnpj: "12260723000109", inscricaomunicipal: "1094653", ...empresa }],
      nfse_config: [{ empresa_id: 1, token: "token-de-teste", padroes_emissao: padroesEmissao, incluir_garantia_os: false }],
      config_geral: [],
      nfse: [],
    },
  ).instalar();
}

const requisicao = (url: string, corpo: unknown, method = "POST") =>
  new NextRequest(url, { method, body: JSON.stringify(corpo), headers: { "Content-Type": "application/json" } });

/**
 * As rotas usam o dia de hoje. Os testes que dependem do modelo Nacional só
 * fazem sentido depois de 01/10/2026 — data em que a regra entrou e em que
 * este teste foi escrito —, então o relógio é fixado em 02/10/2026.
 */
function fixarHoje() {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-02T15:00:00Z") });
}

afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
});

describe("GET/PUT /api/config/nfse — Teste 6 pela rota", () => {
  it("CST PIS/COFINS salva e volta na leitura, sem copiar o municipal", async () => {
    fixarHoje();
    const db = bancoDemir({ MUNICIPAL_JOAO_PESSOA: PADRAO_JOAO_PESSOA });
    const padrao = { ...PADRAO_NACIONAL, situacaoTributariaPisCofins: "01", codigoTributacaoMunicipalIss: "123" };
    assert.equal((await salvarConfigNfse(requisicao("http://localhost/api/config/nfse", { nfse: { padroesEmissao: { NACIONAL: padrao } } }, "PUT"))).status, 200);
    const lido = await (await lerConfigNfse()).json();
    assert.equal(lido.nfse.padroesEmissao.NACIONAL.situacaoTributariaPisCofins, "01");
    assert.equal(lido.nfse.padroesEmissao.NACIONAL.codigoTributacaoMunicipalIss, "123");
    assert.deepEqual(db.tabela("nfse_config")[0].padroes_emissao.MUNICIPAL_JOAO_PESSOA, PADRAO_JOAO_PESSOA);
  });
  it("configuração recusa CST inválido sem modificar o padrão gravado", async () => {
    fixarHoje();
    const db = bancoDemir({ NACIONAL: PADRAO_NACIONAL });
    for (const cst of ["0", "10", "000", "XX"]) {
      const resposta = await salvarConfigNfse(requisicao("http://localhost/api/config/nfse", { nfse: { padroesEmissao: { NACIONAL: { ...PADRAO_NACIONAL, situacaoTributariaPisCofins: cst } } } }, "PUT"));
      assert.equal(resposta.status, 400);
      assert.match((await resposta.json()).error, /PIS\/COFINS/);
      assert.deepEqual(db.tabela("nfse_config")[0].padroes_emissao.NACIONAL, PADRAO_NACIONAL);
    }
  });

  it("salvar a aba com o Nacional preserva o municipal de João Pessoa", async () => {
    fixarHoje();
    const banco = bancoDemir({ MUNICIPAL_JOAO_PESSOA: PADRAO_JOAO_PESSOA });

    const resposta = await salvarConfigNfse(
      requisicao("http://localhost/api/config/nfse", { nfse: { padroesEmissao: { NACIONAL: PADRAO_NACIONAL } } }, "PUT"),
    );
    assert.equal(resposta.status, 200);

    const gravado = banco.tabela("nfse_config")[0].padroes_emissao;
    assert.deepEqual(gravado.MUNICIPAL_JOAO_PESSOA, PADRAO_JOAO_PESSOA);
    assert.deepEqual(gravado.NACIONAL, PADRAO_NACIONAL);

    const lido = await (await lerConfigNfse()).json();
    assert.deepEqual(Object.keys(lido.nfse.padroesEmissao).sort(), ["MUNICIPAL_JOAO_PESSOA", "NACIONAL"]);
    assert.equal(lido.nfse.modeloEmissao, "NACIONAL");
    assert.deepEqual(lido.nfse.modelosEmissao, ["NACIONAL", "MUNICIPAL_JOAO_PESSOA"]);
  });

  it("salvar a aba com os dois modelos mantém os dois", async () => {
    fixarHoje();
    const banco = bancoDemir({ MUNICIPAL_JOAO_PESSOA: PADRAO_JOAO_PESSOA, NACIONAL: PADRAO_NACIONAL });
    await salvarConfigNfse(requisicao("http://localhost/api/config/nfse", {
      nfse: { padroesEmissao: { MUNICIPAL_JOAO_PESSOA: PADRAO_JOAO_PESSOA, NACIONAL: PADRAO_NACIONAL } },
    }, "PUT"));
    const gravado = banco.tabela("nfse_config")[0].padroes_emissao;
    assert.deepEqual(gravado, { MUNICIPAL_JOAO_PESSOA: PADRAO_JOAO_PESSOA, NACIONAL: PADRAO_NACIONAL });
  });

  it("salvar só a garantia não toca nos padrões", async () => {
    fixarHoje();
    const banco = bancoDemir({ MUNICIPAL_JOAO_PESSOA: PADRAO_JOAO_PESSOA, NACIONAL: PADRAO_NACIONAL });
    await salvarConfigNfse(requisicao("http://localhost/api/config/nfse", { nfse: { incluirGarantiaOs: true } }, "PUT"));
    const gravado = banco.tabela("nfse_config")[0].padroes_emissao;
    assert.deepEqual(gravado, { MUNICIPAL_JOAO_PESSOA: PADRAO_JOAO_PESSOA, NACIONAL: PADRAO_NACIONAL });
  });
});
