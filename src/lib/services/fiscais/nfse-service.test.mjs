import assert from "node:assert/strict";
import test from "node:test";
import { NFSeService } from "./nfse-service.ts";

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

const itemServico = {
  servicoid: 7,
  quantidade: 2,
  precounitario: 50,
  servico: {
    descricao: "Manutenção",
    aliquotaiss: 5,
    cnae: "CODIGO_ANTIGO",
    itemlistaservico: "99.99",
  },
};

test("mapeamento municipal usa os códigos informados durante a emissão", () => {
  const service = new NFSeService();
  const result = service.mapearOSParaFocus(os, empresa, itemServico, {
    item_lista_servico: "14.01",
    codigo_cnae: "452000100",
    codigo_tributario_municipio: "1401",
    codigo_nbs: "103031100",
    aliquota_iss: 2.5,
  });

  assert.equal(result.servico.item_lista_servico, "14.01");
  assert.equal(result.servico.codigo_cnae, "452000100");
  assert.equal(result.servico.codigo_tributario_municipio, "1401");
  assert.equal(result.servico.codigo_nbs, "103031100");
  assert.equal(result.servico.aliquota, 2.5);
});

test("mapeamento nacional não cria código tributário fixo ou derivado", () => {
  const service = new NFSeService();
  const result = service.mapearOSParaFocusNacional(os, empresa, itemServico, {
    codigo_tributacao_nacional_iss: "010701",
    codigo_tributario_municipio: "107",
    codigo_nbs: "1.0303.11.00",
    aliquota_iss: 3,
  });

  assert.equal(result.codigo_tributacao_nacional_iss, "010701");
  assert.equal(result.codigo_tributacao_municipal_iss, "107");
  assert.equal(result.codigo_nbs, "103031100");
  assert.equal(result.percentual_aliquota_relativa_municipio, 3);
});
