import assert from "node:assert/strict";
import test from "node:test";
import { NFSeService, identificarModeloEmissao } from "./nfse-service.ts";

const os = {
  id: 42,
  cliente: {
    cpfcnpj: "12345678901",
    nomerazaosocial: "Cliente Teste",
    endereco: "Rua Teste",
    endereconumero: "10",
    bairro: "Centro",
    codigomunicipio: "2507507",
    estado: "PB",
    cep: "58000000",
  },
};

const empresa = {
  cnpj: "12345678000199",
  inscricaomunicipal: "12345",
  codigomunicipio: "2507507",
  regimetributario: "3",
  uf: "PB",
};

const itens = [
  {
    servicoid: 7,
    quantidade: 2,
    valor: 125.5,
    servico: { descricao: "Manuten\u00e7\u00e3o preventiva" },
  },
  {
    servicoid: 8,
    quantidade: 1,
    valor: 80,
    servico: { descricao: "Diagn\u00f3stico eletr\u00f4nico" },
  },
];

const fiscalMunicipal = {
  item_lista_servico: "14.01",
  codigo_cnae: "452000100",
  codigo_nbs: "103031100",
  aliquota_iss: 2.5,
  natureza_operacao: 1,
  iss_retido: false,
  informacoes_complementares: "Garantia conforme a ordem de servi\u00e7o.",
};

const fiscalNacional = {
  codigo_tributacao_nacional_iss: "010701",
  codigo_nbs: "103031100",
  aliquota_iss: 3,
  tributacao_iss: 1,
  tipo_retencao_iss: 1,
  finalidade_emissao: 0,
  consumidor_final: 1,
  indicador_destinatario: 0,
  ibs_cbs_situacao_tributaria: "000",
  ibs_cbs_classificacao_tributaria: "000001",
  informacoes_complementares: "Documento emitido pelo ambiente nacional.",
};

test("Jo\u00e3o Pessoa consolida servi\u00e7os, soma os valores editados e envia informa\u00e7\u00f5es complementares", () => {
  const service = new NFSeService();
  const result = service.mapearOSParaFocus(os, empresa, itens, fiscalMunicipal);

  assert.equal(result.servico.valor_servicos, 205.5);
  assert.match(result.servico.discriminacao, /Manuten\u00e7\u00e3o preventiva/);
  assert.match(result.servico.discriminacao, /Diagn\u00f3stico eletr\u00f4nico/);
  assert.ok(result.servico.discriminacao.includes(fiscalMunicipal.informacoes_complementares));
  assert.equal(result.informacoes_adicionais_contribuinte, undefined);
  assert.equal(result.servico.item_lista_servico, "14.01");
  assert.equal(result.servico.codigo_cnae, "452000100");
  assert.equal(result.servico.iss_retido, false);
  assert.equal(result.servico.codigo_tributario_municipio, undefined);
});

test("Cabedelo envia a classifica\u00e7\u00e3o fiscal comum e os campos opcionais da reforma quando preenchidos", () => {
  const service = new NFSeService();
  const result = service.mapearOSParaFocusCabedelo(
    os,
    { ...empresa, codigomunicipio: "2503209" },
    itens,
    {
      ...fiscalMunicipal,
      finalidade_emissao: 0,
      consumidor_final: 1,
      indicador_destinatario: 0,
      codigo_indicador_operacao: "100001",
      ibs_cbs_situacao_tributaria: "000",
      ibs_cbs_classificacao_tributaria: "000001",
    },
  );

  assert.equal(result.servico.valor_servicos, 205.5);
  assert.equal(result.finalidade_emissao, 0);
  assert.equal(result.consumidor_final, 1);
  assert.equal(result.servico.codigo_indicador_operacao, "100001");
  assert.equal(result.servico.ibs_cbs_situacao_tributaria, "000");
  assert.equal(result.servico.ibs_cbs_classificacao_tributaria, "000001");
});

test("MEI nacional consolida servi\u00e7os e envia os campos obrigat\u00f3rios de 2026", () => {
  const service = new NFSeService();
  const result = service.mapearOSParaFocusNacional(
    os,
    { ...empresa, regimetributario: "4" },
    itens,
    fiscalNacional,
  );

  assert.equal(result.codigo_opcao_simples_nacional, 2);
  assert.equal(result.valor_servico, 205.5);
  assert.equal(result.tributacao_iss, 1);
  assert.equal(result.tipo_retencao_iss, 1);
  assert.equal(result.finalidade_emissao, 0);
  assert.equal(result.consumidor_final, 1);
  assert.equal(result.indicador_destinatario, 0);
  assert.equal(result.ibs_cbs_situacao_tributaria, "000");
  assert.equal(result.ibs_cbs_classificacao_tributaria, "000001");
  assert.equal(result.informacoes_complementares, fiscalNacional.informacoes_complementares);
});

test("o valor informado para a nota \u00e9 obrigat\u00f3rio e n\u00e3o usa o pre\u00e7o cadastrado como fallback", () => {
  const service = new NFSeService();
  const itemSemValor = [{ ...itens[0], valor: 0, precounitario: 999 }];

  assert.throws(
    () => service.mapearOSParaFocus(os, empresa, itemSemValor, fiscalMunicipal),
    /valor maior que zero/,
  );
});

test("cada ambiente bloqueia seus campos fiscais obrigat\u00f3rios sem aplicar fallback", () => {
  const service = new NFSeService();

  assert.throws(
    () => service.mapearOSParaFocus(os, empresa, itens, { ...fiscalMunicipal, natureza_operacao: undefined }),
    /natureza da opera\u00e7\u00e3o/,
  );
  assert.throws(
    () => service.mapearOSParaFocusCabedelo(
      os,
      { ...empresa, codigomunicipio: "2503209" },
      itens,
      { ...fiscalMunicipal, codigo_cnae: "" },
    ),
    /CNAE/,
  );
  assert.throws(
    () => service.mapearOSParaFocusNacional(
      os,
      { ...empresa, regimetributario: "4" },
      itens,
      { ...fiscalNacional, ibs_cbs_situacao_tributaria: "" },
    ),
    /CST do IBS\/CBS/,
  );
});

test("identificarModeloEmissao resolve o modelo pelo regime e pelo IBGE do munic\u00edpio", () => {
  assert.equal(identificarModeloEmissao({ codigomunicipio: "2507507", regimetributario: "3" }), "MUNICIPAL_JOAO_PESSOA");
  assert.equal(identificarModeloEmissao({ codigomunicipio: "2503209", regimetributario: "1" }), "MUNICIPAL_CABEDELO");
  assert.equal(identificarModeloEmissao({ codigomunicipio: "2503209", regimetributario: "4" }), "NACIONAL");
  assert.equal(identificarModeloEmissao({ codigomunicipio: "3550308", regimetributario: "3" }), null);
  assert.equal(identificarModeloEmissao(null), null);
});

test("informa\u00e7\u00f5es complementares respeitam o limite da Focus", () => {
  const service = new NFSeService();

  assert.throws(
    () => service.mapearOSParaFocus(os, empresa, itens, {
      ...fiscalMunicipal,
      informacoes_complementares: "x".repeat(2001),
    }),
    /m\u00e1ximo 2\.000 caracteres/,
  );
});
