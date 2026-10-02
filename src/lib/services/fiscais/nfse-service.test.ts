import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  NFSeService,
  conferirCodigosFiscaisNFSe,
  identificarModeloEmissao,
  opcaoSimplesNacionalDoPrestador,
  textoParaDpsNacional,
  type NFSeCodigosFiscais,
  type NFSeItemEmissao,
} from "./nfse-service";
import { resolverPoliticaNFSe } from "./nfse-politica";

/*
 * Substitui o antigo nfse-service.test.mjs, que o runner (`*.test.ts`) nunca
 * executava — e que já não passaria: o CPF do tomador era inválido.
 *
 * Os códigos fiscais do padrão Nacional abaixo são FIXTURES de teste. Não são
 * a classificação da Demir nem de ninguém: o ERP não tem esses valores no
 * código, e quem cadastra é a empresa no padrão Nacional.
 */

const os = {
  id: 42,
  cliente: {
    cpfcnpj: "12345678909",
    nomerazaosocial: "Cliente Teste",
    endereco: "Rua Teste",
    endereconumero: "10",
    bairro: "Centro",
    codigomunicipio: "2507507",
    estado: "PB",
    cep: "58000000",
  },
};

const empresaJoaoPessoa = {
  cnpj: "12260723000109",
  inscricaomunicipal: "1094653",
  codigomunicipio: "2507507",
  regimetributario: "3",
  uf: "PB",
};

const itens: NFSeItemEmissao[] = [
  { servicoid: 7, quantidade: 2, valor: 125.5, servico: { descricao: "Manutenção preventiva" } },
  { servicoid: 8, quantidade: 1, valor: 80, servico: { descricao: "Diagnóstico eletrônico" } },
];

const fiscalMunicipal: NFSeCodigosFiscais = {
  item_lista_servico: "14.01",
  codigo_cnae: "452000100",
  codigo_nbs: "103031100",
  aliquota_iss: 2.5,
  natureza_operacao: 1,
  iss_retido: false,
  informacoes_complementares: "Garantia conforme a ordem de serviço.",
};

const fiscalNacionalSemRtc: NFSeCodigosFiscais = {
  codigo_tributacao_nacional_iss: "140101",
  tributacao_iss: 1,
  tipo_retencao_iss: 1,
  informacoes_complementares: "Documento emitido pelo ambiente nacional.",
};

const grupoRtc: NFSeCodigosFiscais = {
  finalidade_emissao: 0,
  consumidor_final: 0,
  indicador_destinatario: 0,
  codigo_indicador_operacao: "100301",
  ibs_cbs_situacao_tributaria: "000",
  ibs_cbs_classificacao_tributaria: "000001",
};

const fiscalNacional: NFSeCodigosFiscais = { ...fiscalNacionalSemRtc, ...grupoRtc };

const politicaDe = (empresa: Record<string, unknown>, dataCompetencia: string) => resolverPoliticaNFSe({
  codigoMunicipio: empresa.codigomunicipio,
  regimeTributario: empresa.regimetributario,
  dataCompetencia,
  itensListaServico: ["14.01"],
})!;

describe("emissor municipal (inalterado)", () => {
  it("João Pessoa consolida serviços, soma os valores e leva as informações complementares", () => {
    const result = new NFSeService().mapearOSParaFocus(os, empresaJoaoPessoa, itens, fiscalMunicipal);

    assert.equal(result.servico.valor_servicos, 205.5);
    assert.match(result.servico.discriminacao, /Manutenção preventiva/);
    assert.match(result.servico.discriminacao, /Diagnóstico eletrônico/);
    assert.ok(result.servico.discriminacao.includes(String(fiscalMunicipal.informacoes_complementares)));
    assert.equal(result.servico.item_lista_servico, "14.01");
    assert.equal(result.servico.codigo_cnae, "452000100");
    assert.equal(result.servico.iss_retido, false);
    assert.equal(result.optante_simples_nacional, false);
  });

  it("Cabedelo leva os campos opcionais da reforma quando preenchidos", () => {
    const result = new NFSeService().mapearOSParaFocusCabedelo(
      os,
      { ...empresaJoaoPessoa, codigomunicipio: "2503209", regimetributario: "1" },
      itens,
      { ...fiscalMunicipal, ...grupoRtc, consumidor_final: 1 },
    );

    assert.equal(result.servico.valor_servicos, 205.5);
    assert.equal(result.finalidade_emissao, 0);
    assert.equal(result.consumidor_final, 1);
    assert.equal(result.servico.ibs_cbs_situacao_tributaria, "000");
    assert.equal(result.regime_tributario_simples_nacional, 1);
  });

  it("valor da nota é obrigatório e não cai no preço do cadastro", () => {
    assert.throws(
      () => new NFSeService().mapearOSParaFocus(os, empresaJoaoPessoa, [{ ...itens[0], valor: 0 }], fiscalMunicipal),
      /valor maior que zero/,
    );
  });

  it("cada emissor bloqueia seus campos obrigatórios sem fallback", () => {
    const service = new NFSeService();
    assert.throws(
      () => service.mapearOSParaFocus(os, empresaJoaoPessoa, itens, { ...fiscalMunicipal, natureza_operacao: undefined }),
      /natureza da operação/,
    );
    assert.throws(
      () => service.mapearOSParaFocusCabedelo(
        os, { ...empresaJoaoPessoa, codigomunicipio: "2503209" }, itens, { ...fiscalMunicipal, codigo_cnae: "" },
      ),
      /CNAE/,
    );
  });

  it("informações complementares respeitam o limite da Focus", () => {
    assert.throws(
      () => new NFSeService().mapearOSParaFocus(os, empresaJoaoPessoa, itens, {
        ...fiscalMunicipal, informacoes_complementares: "x".repeat(2001),
      }),
      /máximo 2\.000 caracteres/,
    );
  });
});

describe("declaração do prestador na DPS Nacional", () => {
  it("Caso F: CRT 3 nunca sai como MEI", () => {
    assert.deepEqual(opcaoSimplesNacionalDoPrestador("3"), { codigo_opcao_simples_nacional: 1 });
    const payload = new NFSeService().mapearOSParaFocusNacional(os, empresaJoaoPessoa, itens, fiscalNacional, {
      dataCompetencia: "2026-10-02",
    });
    assert.equal(payload.codigo_opcao_simples_nacional, 1);
    assert.notEqual(payload.codigo_opcao_simples_nacional, 2);
    assert.equal("regime_tributario_simples_nacional" in payload, false);
  });

  it("MEI é 2", () => {
    assert.deepEqual(opcaoSimplesNacionalDoPrestador("4"), { codigo_opcao_simples_nacional: 2 });
  });

  it("ME/EPP é 3; CRT 1 apura ISS no Simples salvo configuração", () => {
    assert.deepEqual(
      opcaoSimplesNacionalDoPrestador("1"),
      { codigo_opcao_simples_nacional: 3, regime_tributario_simples_nacional: 1 },
    );
    assert.deepEqual(
      opcaoSimplesNacionalDoPrestador("1", "2"),
      { codigo_opcao_simples_nacional: 3, regime_tributario_simples_nacional: 2 },
    );
  });

  it("CRT 2 exige o regime de apuração cadastrado", () => {
    assert.throws(() => opcaoSimplesNacionalDoPrestador("2"), /excesso de sublimite/);
    assert.deepEqual(
      opcaoSimplesNacionalDoPrestador("2", 3),
      { codigo_opcao_simples_nacional: 3, regime_tributario_simples_nacional: 3 },
    );
  });

  it("regime em branco não vira MEI nem Simples", () => {
    assert.throws(() => opcaoSimplesNacionalDoPrestador(""), /regime tributário/);
  });
});

describe("mapeador Nacional", () => {
  it("Caso E: MEI continua emitindo, sem o grupo da Reforma em 2026", () => {
    const empresaMei = { ...empresaJoaoPessoa, codigomunicipio: "2503209", regimetributario: "4" };
    const result = new NFSeService().mapearOSParaFocusNacional(os, empresaMei, itens, fiscalNacionalSemRtc, {
      politica: politicaDe(empresaMei, "2026-10-02"),
      dataCompetencia: "2026-10-02",
    });
    assert.equal(result.codigo_opcao_simples_nacional, 2);
    assert.equal(result.valor_servico, 205.5);
    assert.equal(result.finalidade_emissao, undefined);
    assert.equal(result.ibs_cbs_situacao_tributaria, undefined);
    assert.equal(result.informacoes_complementares, fiscalNacionalSemRtc.informacoes_complementares);
  });

  it("MEI que preencheu o grupo da Reforma leva o grupo", () => {
    const empresaMei = { ...empresaJoaoPessoa, regimetributario: "4" };
    const result = new NFSeService().mapearOSParaFocusNacional(os, empresaMei, itens, fiscalNacional, {
      dataCompetencia: "2026-10-02",
    });
    assert.equal(result.ibs_cbs_situacao_tributaria, "000");
    assert.equal(result.codigo_indicador_operacao, "100301");
  });

  it("regime normal sem o grupo da Reforma é bloqueado, sem valor presumido", () => {
    assert.throws(
      () => new NFSeService().mapearOSParaFocusNacional(os, empresaJoaoPessoa, itens, fiscalNacionalSemRtc, {
        dataCompetencia: "2026-10-02",
      }),
      /finalidade da emissão/,
    );
    assert.throws(
      () => new NFSeService().mapearOSParaFocusNacional(os, empresaJoaoPessoa, itens, {
        ...fiscalNacional, codigo_indicador_operacao: undefined,
      }, { dataCompetencia: "2026-10-02" }),
      /cIndOp/,
    );
  });

  it("grupo da Reforma começado pela metade é bloqueado mesmo quando não é exigido", () => {
    const regra = { modelo: "NACIONAL" as const, exigeRtc: false };
    assert.equal(conferirCodigosFiscaisNFSe(regra, fiscalNacionalSemRtc), null);
    assert.match(
      String(conferirCodigosFiscaisNFSe(regra, { ...fiscalNacionalSemRtc, ibs_cbs_situacao_tributaria: "000" })),
      /finalidade/,
    );
  });

  it("cTribMun do Nacional tem 3 dígitos — o código do emissor antigo não passa", () => {
    const regra = { modelo: "NACIONAL" as const, exigeRtc: true };
    assert.match(
      String(conferirCodigosFiscaisNFSe(regra, { ...fiscalNacional, codigo_tributacao_municipal_iss: "4520001" })),
      /3 dígitos/,
    );
    assert.equal(conferirCodigosFiscaisNFSe(regra, { ...fiscalNacional, codigo_tributacao_municipal_iss: "001" }), null);
  });

  it("recusa montar DPS quando a política manda para o municipal", () => {
    assert.throws(
      () => new NFSeService().mapearOSParaFocusNacional(os, empresaJoaoPessoa, itens, fiscalNacional, {
        dataCompetencia: "2026-09-30",
      }),
      /não usa o padrão Nacional/,
    );
  });

  it("a data de competência é a recebida, não a do relógio", () => {
    const result = new NFSeService().mapearOSParaFocusNacional(os, empresaJoaoPessoa, itens, fiscalNacional, {
      dataCompetencia: "2026-10-02",
    });
    assert.equal(result.data_competencia, "2026-10-02");
  });

  it("regime especial vem do padrão; sem padrão é 0 (Nenhum)", () => {
    const service = new NFSeService();
    const contexto = { dataCompetencia: "2026-10-02" };
    assert.equal(service.mapearOSParaFocusNacional(os, empresaJoaoPessoa, itens, fiscalNacional, contexto).regime_especial_tributacao, 0);
    assert.equal(
      service.mapearOSParaFocusNacional(os, empresaJoaoPessoa, itens, { ...fiscalNacional, regime_especial_tributacao: 6 }, contexto)
        .regime_especial_tributacao,
      6,
    );
  });
});

describe("identificarModeloEmissao delega à política", () => {
  it("resolve com data e itens", () => {
    assert.equal(identificarModeloEmissao(empresaJoaoPessoa, { dataCompetencia: "2026-09-30" }), "MUNICIPAL_JOAO_PESSOA");
    assert.equal(identificarModeloEmissao(empresaJoaoPessoa, { dataCompetencia: "2026-10-02" }), "NACIONAL");
    assert.equal(
      identificarModeloEmissao({ codigomunicipio: "2503209", regimetributario: "1" }, { dataCompetencia: "2026-10-02" }),
      "MUNICIPAL_CABEDELO",
    );
    assert.equal(identificarModeloEmissao(null, { dataCompetencia: "2026-10-02" }), null);
  });
});

/*
 * Caso H — a OS 525 da Demir, rejeitada em 02/10/2026 com o L999 de migração.
 * Mesmos serviços (TESTE COMPUTADORIZADO e MÃO DE OBRA PARTE ELÉTRICA, os dois
 * no item 14.01) e mesmos valores do envio recusado. O tomador está trocado por
 * um documento de teste.
 */
describe("Caso H: OS 525 chega ao mapeador Nacional e sai por /v2/nfsen", () => {
  const os525 = {
    id: 525,
    cliente: {
      cpfcnpj: "11444777000161",
      tipopessoa: "JURIDICA",
      nomerazaosocial: "TOMADOR DE TESTE LTDA",
      endereco: "RUA DE TESTE",
      endereconumero: "100",
      bairro: "CENTRO",
      codigomunicipio: "2933307",
      estado: "BA",
      cep: "45065075",
    },
  };
  const itens525: NFSeItemEmissao[] = [
    { servicoid: 12, quantidade: 1, valor: 284.93, ordemServicoId: 525, servico: { descricao: "TESTE COMPUTADORIZADO" } },
    { servicoid: 15, quantidade: 1, valor: 3324.11, ordemServicoId: 525, servico: { descricao: "MAO DE OBRA PARTE ELETRICA" } },
  ];

  const fetchOriginal = globalThis.fetch;
  let urls: string[] = [];
  beforeEach(() => {
    urls = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ status: "processando_autorizacao" }), { status: 202 });
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  it("a política da OS 525 é Nacional com RTC exigida", () => {
    const politica = resolverPoliticaNFSe({
      codigoMunicipio: "2507507",
      regimeTributario: "3",
      dataCompetencia: "2026-10-02",
      itensListaServico: ["14.01", "14.01"],
    });
    assert.equal(politica?.modelo, "NACIONAL");
    assert.equal(politica?.exigeRtc, true);
  });

  it("o mapeador monta a DPS com a Demir como não optante", () => {
    const politica = politicaDe(empresaJoaoPessoa, "2026-10-02");
    const dps = new NFSeService().mapearOSParaFocusNacional(os525, empresaJoaoPessoa, itens525, fiscalNacional, {
      politica,
      dataCompetencia: "2026-10-02",
    });
    assert.match(dps.referencia, /^OS_525_SRVS_12-15_\d+$/);
    assert.equal(dps.data_competencia, "2026-10-02");
    assert.equal(dps.codigo_municipio_emissora, 2507507);
    assert.equal(dps.codigo_municipio_prestacao, "2507507");
    assert.equal(dps.cnpj_prestador, "12260723000109");
    assert.equal(dps.inscricao_municipal_prestador, "1094653");
    assert.equal(dps.codigo_opcao_simples_nacional, 1);
    assert.equal(dps.valor_servico, 3609.04);
    assert.equal(dps.cnpj_tomador, "11444777000161");
    assert.match(dps.descricao_servico, /TESTE COMPUTADORIZADO/);
    assert.match(dps.descricao_servico, /MAO DE OBRA PARTE ELETRICA/);
    // Nada do emissor municipal vaza para a DPS.
    assert.equal("item_lista_servico" in dps, false);
    assert.equal("codigo_cnae" in dps, false);
    assert.equal(dps.codigo_tributacao_municipal_iss, undefined);
  });

  it("vai para /v2/nfsen e não para /v2/nfse", async () => {
    const service = new NFSeService();
    service.configurarAmbiente("HOMOLOGACAO", "token-de-teste");
    const dps = service.mapearOSParaFocusNacional(os525, empresaJoaoPessoa, itens525, fiscalNacional, {
      dataCompetencia: "2026-10-02",
    });
    await service.emitirNacional(dps);
    assert.equal(urls.length, 1);
    assert.match(urls[0], /\/v2\/nfsen\?ref=OS_525_SRVS_12-15_/);
    assert.doesNotMatch(urls[0], /\/v2\/nfse\?/);
  });

  it("Caso G: nota municipal antiga continua consultável e cancelável em /v2/nfse", async () => {
    const service = new NFSeService();
    service.configurarAmbiente("HOMOLOGACAO", "token-de-teste");
    await service.consultar("OS_489_SRVS_16_1790794612861", "MUNICIPAL");
    await service.cancelar("OS_489_SRVS_16_1790794612861", "Cancelamento de teste automatizado", "MUNICIPAL");
    await service.consultar("OS_525_SRVS_12-15_1", "NACIONAL");
    assert.match(urls[0], /\/v2\/nfse\/OS_489_SRVS_16_1790794612861$/);
    assert.match(urls[1], /\/v2\/nfse\/OS_489_SRVS_16_1790794612861$/);
    assert.match(urls[2], /\/v2\/nfsen\/OS_525_SRVS_12-15_1$/);
  });
});

/*
 * Nota 138 da Demir (OS 525, 02/10/2026): recusada pelo schema da DPS porque
 * `informacoes_complementares` tinha quebra de linha. O padrão abaixo é o que
 * a Focus devolveu na recusa, ancorado como o XSD aplica.
 */
describe("texto livre no charset da DPS Nacional", () => {
  const PADRAO_XINFCOMP = /^(?:[!-ÿ][ -ÿ]*[!-ÿ]|[!-ÿ])$/u;
  const TEXTO_NOTA_138 = "Placa: PKR9990 • Marca: VOLVO • Ano: 2017\nGarantia: 90 dias";

  it("o texto da nota 138 passa a casar com o padrão do xInfComp", () => {
    assert.doesNotMatch(TEXTO_NOTA_138, PADRAO_XINFCOMP);
    const convertido = textoParaDpsNacional(TEXTO_NOTA_138, "separador");
    assert.equal(convertido, "Placa: PKR9990 - Marca: VOLVO - Ano: 2017 | Garantia: 90 dias");
    assert.match(convertido, PADRAO_XINFCOMP);
  });

  it("preserva os acentos do português", () => {
    assert.equal(textoParaDpsNacional("Revisão de injeção — garantia", "separador"), "Revisão de injeção - garantia");
  });

  it("tira espaço das pontas, linhas vazias e símbolos sem equivalente", () => {
    assert.equal(textoParaDpsNacional("  \n\nPedido 1862  \r\n\r\n  NF 182 ✅ \n", "separador"), "Pedido 1862 | NF 182");
    assert.equal(textoParaDpsNacional("“aspas” e ‘simples’ …", "separador"), "\"aspas\" e 'simples' ...");
  });

  it("é idempotente", () => {
    const uma = textoParaDpsNacional(TEXTO_NOTA_138, "separador");
    assert.equal(textoParaDpsNacional(uma, "separador"), uma);
  });

  it("na discriminação mantém as linhas e troca o travessão", () => {
    const discriminacao = "OS #525\n1. TESTE COMPUTADORIZADO — 1 un. — R$ 284,93\n2. MAO DE OBRA PARTE ELETRICA — 1 un. — R$ 3.324,11";
    assert.equal(
      textoParaDpsNacional(discriminacao, "manter"),
      "OS #525\n1. TESTE COMPUTADORIZADO - 1 un. - R$ 284,93\n2. MAO DE OBRA PARTE ELETRICA - 1 un. - R$ 3.324,11",
    );
  });

  it("o mapeador já entrega o texto convertido", () => {
    const dps = new NFSeService().mapearOSParaFocusNacional(os, empresaJoaoPessoa, itens, {
      ...fiscalNacional,
      informacoes_complementares: TEXTO_NOTA_138,
    }, { dataCompetencia: "2026-10-02" });
    assert.match(String(dps.informacoes_complementares), PADRAO_XINFCOMP);
    assert.doesNotMatch(dps.descricao_servico, /—/);
  });

  it("o reenvio do payload gravado da nota 138 sai convertido", async () => {
    const enviados: Array<Record<string, unknown>> = [];
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      enviados.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ status: "processando_autorizacao" }), { status: 202 });
    }) as typeof fetch;
    try {
      const service = new NFSeService();
      service.configurarAmbiente("HOMOLOGACAO", "token-de-teste");
      await service.emitirNacional({
        referencia: "OS_525_SRVS_12-15_1",
        descricao_servico: "OS #525\n1. TESTE COMPUTADORIZADO — 1 un. — R$ 284,93",
        informacoes_complementares: TEXTO_NOTA_138,
      } as never);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
    assert.match(String(enviados[0].informacoes_complementares), PADRAO_XINFCOMP);
    assert.equal(enviados[0].descricao_servico, "OS #525\n1. TESTE COMPUTADORIZADO - 1 un. - R$ 284,93");
  });
});
