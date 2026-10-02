// Integração: o padrão fiscal que abre na revisão da NFS-e é o do modelo
// resolvido para os serviços SELECIONADOS, e a emissão resolve o mesmo.
//
// Regressão de 02/10/2026 na Demir: a política passou a mandar João Pessoa
// CRT 3 / 14.01 para o Nacional, o banco só tinha `padroes_emissao.
// MUNICIPAL_JOAO_PESSOA`, e a revisão abria em branco sem dizer por quê. E a
// listagem decidia o modelo pela OS inteira enquanto a emissão decidia pela
// seleção — uma OS com 01.03 e 14.01 podia carregar um padrão e sair por outro.

import "./__testEnv";

import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";

import { BancoFalso } from "./__bancoFalso";
import { POST as contextoEmissao } from "@/app/api/nfse/contexto-emissao/[id]/route";
import { POST as emitirDeOs } from "@/app/api/nfse/de-os/[id]/route";
import { GET as lerConfigNfse, PUT as salvarConfigNfse } from "@/app/api/config/nfse/route";
import { resolverContextoEmissaoNFSe } from "@/lib/services/fiscais/nfse-politica";
import { mesclarPadroesEmissaoNfse } from "@/lib/fiscal/padroesEmissaoNfse";
import { montarCodigosDaRevisao } from "@/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nfse-dialog/codigos-da-revisao";

const DEMIR = { id: 1, codigomunicipio: "2507507", regimetributario: "3", ambiente: "PRODUCAO", uf: "PB" };
const HOJE = "2026-10-02";

/** Padrão municipal exatamente como está no banco da Demir. */
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

describe("formulário da revisão", () => {
  const servicoMunicipal = {
    servicoid: 12, quantidade: 1, precounitario: 300,
    servico: { descricao: "TESTE", itemlistaservico: "14.01", cnae: "452000100", aliquotaiss: 5, codigoservicomunicipal: "4520001" },
  };

  it("Nacional sem padrão abre vazio — nada do cadastro municipal entra", () => {
    const codigos = montarCodigosDaRevisao({ modelo: "NACIONAL", padraoFiscal: null, servicos: [servicoMunicipal], observacoes: "" });
    assert.equal(codigos.codigoTributacaoNacionalIss, "");
    assert.equal(codigos.codigoTributacaoMunicipalIss, "");
    assert.equal(codigos.codigoNbs, "");
    assert.equal(codigos.codigoIndicadorOperacao, "");
    assert.equal(codigos.ibsCbsSituacaoTributaria, "");
    assert.equal(codigos.ibsCbsClassificacaoTributaria, "");
    assert.equal(codigos.itemListaServico, "");
    assert.equal(codigos.codigoCnae, "");
    assert.equal(codigos.aliquotaIss, "");
  });

  it("Nacional com padrão abre com o padrão", () => {
    const codigos = montarCodigosDaRevisao({ modelo: "NACIONAL", padraoFiscal: PADRAO_NACIONAL, servicos: [servicoMunicipal], observacoes: "" });
    assert.equal(codigos.codigoTributacaoNacionalIss, "140101");
    assert.equal(codigos.codigoIndicadorOperacao, "050101");
    assert.equal(codigos.ibsCbsClassificacaoTributaria, "000001");
  });

  it("municipal continua como antes: cadastro do serviço, depois padrão", () => {
    const codigos = montarCodigosDaRevisao({
      modelo: "MUNICIPAL_JOAO_PESSOA", padraoFiscal: PADRAO_JOAO_PESSOA, servicos: [servicoMunicipal], observacoes: "Pedido 1862",
    });
    assert.equal(codigos.itemListaServico, "14.01");
    assert.equal(codigos.codigoCnae, "452000100");
    assert.equal(codigos.naturezaOperacao, "1");
    assert.equal(codigos.issRetido, "false");
    assert.equal(codigos.informacoesComplementares, "Pedido 1862");
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

const CLIENTE = {
  id: 77,
  tipopessoa: "JURIDICA",
  cpfcnpj: "11444777000161",
  nomerazaosocial: "TOMADOR DE TESTE LTDA",
  endereco: "RUA DE TESTE",
  endereconumero: "100",
  bairro: "CENTRO",
  codigomunicipio: "2507507",
  estado: "PB",
  cep: "58000000",
};

/** OS mista: um serviço na exceção 01.03, outro no 14.01. */
function osMista() {
  return {
    id: 900,
    status: "CONCLUIDO",
    clienteid: CLIENTE.id,
    observacoes_fiscais: null,
    garantia: null,
    cliente: CLIENTE,
    osservico: [
      { servicoid: 3, quantidade: 1, precounitario: 100, subtotal: 100, servico: { id: 3, descricao: "PROGRAMAÇÃO", itemlistaservico: "01.03" } },
      { servicoid: 12, quantidade: 1, precounitario: 300, subtotal: 300, servico: { id: 12, descricao: "TESTE COMPUTADORIZADO", itemlistaservico: "14.01" } },
    ],
  };
}

function bancoDemir(padroesEmissao: Record<string, unknown>) {
  return new BancoFalso(
    {
      empresa: [{ ...DEMIR, cnpj: "12260723000109", inscricaomunicipal: "1094653" }],
      nfse_config: [{ empresa_id: 1, token: "token-de-teste", padroes_emissao: padroesEmissao, incluir_garantia_os: false }],
      ordemservico: [osMista()],
      config_geral: [],
      nfse: [],
      nfse_os_servico_vinculo: [],
    },
    { vincular_nfse_os: () => ({}) },
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

describe("POST /api/nfse/contexto-emissao — a revisão usa a seleção real", () => {
  const padroes = { MUNICIPAL_JOAO_PESSOA: PADRAO_JOAO_PESSOA, NACIONAL: PADRAO_NACIONAL };

  async function contextoDe(servicos: number[], padroesEmissao: Record<string, unknown> = padroes) {
    fixarHoje();
    bancoDemir(padroesEmissao);
    const resposta = await contextoEmissao(
      requisicao("http://localhost/api/nfse/contexto-emissao/900", { servicos }),
      { params: Promise.resolve({ id: "900" }) },
    );
    return { status: resposta.status, corpo: await resposta.json() };
  }

  it("Teste 4: OS mista com só 01.03 selecionado volta para o municipal e carrega o padrão dele", async () => {
    const { status, corpo } = await contextoDe([3]);
    assert.equal(status, 200);
    assert.equal(corpo.modeloEmissao, "MUNICIPAL_JOAO_PESSOA");
    assert.deepEqual(corpo.padraoFiscal, PADRAO_JOAO_PESSOA);
  });

  it("Teste 5: OS mista com só 14.01 selecionado é Nacional com o padrão Nacional", async () => {
    const { corpo } = await contextoDe([12]);
    assert.equal(corpo.modeloEmissao, "NACIONAL");
    assert.deepEqual(corpo.padraoFiscal, PADRAO_NACIONAL);
    assert.equal(corpo.politicaEmissao.exigeRtc, true);
  });

  it("OS mista com os dois selecionados é Nacional", async () => {
    const { corpo } = await contextoDe([3, 12]);
    assert.equal(corpo.modeloEmissao, "NACIONAL");
  });

  it("Teste 2 pela rota: sem padrão Nacional avisa em vez de emprestar o municipal", async () => {
    const { corpo } = await contextoDe([12], { MUNICIPAL_JOAO_PESSOA: PADRAO_JOAO_PESSOA });
    assert.equal(corpo.modeloEmissao, "NACIONAL");
    assert.equal(corpo.padraoFiscal, null);
    assert.equal(corpo.padraoAusente, true);
  });

  it("serviço de outra OS é recusado", async () => {
    const { status } = await contextoDe([999]);
    assert.equal(status, 400);
  });
});

describe("POST /api/nfse/de-os — Teste 8: sem código obrigatório não sai nada", () => {
  it("Nacional sem padrão e sem códigos: 400, mensagem clara, nenhuma chamada à Focus", async () => {
    fixarHoje();
    const banco = bancoDemir({ MUNICIPAL_JOAO_PESSOA: PADRAO_JOAO_PESSOA });
    const chamadas: string[] = [];
    mock.method(globalThis, "fetch", async (url: string) => {
      chamadas.push(String(url));
      return new Response("{}", { status: 202 });
    });

    const resposta = await emitirDeOs(
      requisicao("http://localhost/api/nfse/de-os/900", {
        servicos: [{ osservicoId: 12, valor: 300 }],
        codigosFiscais: { informacoes_complementares: "" },
      }),
      { params: Promise.resolve({ id: "900" }) },
    );
    const corpo = await resposta.json();

    assert.equal(resposta.status, 400);
    assert.match(corpo.message, /Código de Tributação Nacional/);
    assert.deepEqual(chamadas, []);
    assert.equal(banco.tabela("nfse").length, 0, "nenhum registro de NFS-e criado");
  });

  it("Nacional com padrão completo chega à Focus pelo /v2/nfsen", async () => {
    fixarHoje();
    bancoDemir({ MUNICIPAL_JOAO_PESSOA: PADRAO_JOAO_PESSOA, NACIONAL: PADRAO_NACIONAL });
    const chamadas: string[] = [];
    mock.method(globalThis, "fetch", async (url: string) => {
      chamadas.push(String(url));
      return new Response(JSON.stringify({ status: "processando_autorizacao" }), { status: 202 });
    });

    const resposta = await emitirDeOs(
      requisicao("http://localhost/api/nfse/de-os/900", {
        servicos: [{ osservicoId: 12, valor: 300 }],
        codigosFiscais: {
          codigo_tributacao_nacional_iss: "140101",
          codigo_nbs: "120013110",
          tributacao_iss: 1,
          tipo_retencao_iss: 1,
          finalidade_emissao: 0,
          consumidor_final: 0,
          indicador_destinatario: 0,
          codigo_indicador_operacao: "050101",
          ibs_cbs_situacao_tributaria: "000",
          ibs_cbs_classificacao_tributaria: "000001",
        },
      }),
      { params: Promise.resolve({ id: "900" }) },
    );

    assert.equal(resposta.status, 202, JSON.stringify(await resposta.clone().json()));
    assert.equal(chamadas.length, 1);
    assert.match(chamadas[0], /\/v2\/nfsen\?ref=OS_900_SRVS_12_/);
  });
});

describe("GET/PUT /api/config/nfse — Teste 6 pela rota", () => {
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
